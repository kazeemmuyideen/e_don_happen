import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { Subscription } from './entities/subscription.entity.js';
import { PaymentAttempt } from './entities/payment-attempt.entity.js';
import { PaymentEvent } from './entities/payment-event.entity.js';
import { Community } from '../community/entities/community.entity.js';
import { User } from '../identity/entities/user.entity.js';
import { AuditService } from '../audit/audit.service.js';
import { UserRole } from '../identity/interfaces/identity.interface.js';
import {
  CreateBillingSubscriptionDto,
  InitializePaymentDto,
  UpdateBillingSubscriptionDto,
  VerifyPaymentDto,
} from './dto/billing.dto.js';
import {
  PaymentGatewayService,
  type PaymentVerification,
} from './services/payment-gateway.service.js';

const BILLING_PERIOD_DAYS = 30;
const SUCCESS_PAYMENT_EVENTS = new Set(['charge.success', 'payment.success']);
const PAYMENT_AMOUNTS: Record<string, number> = {
  standard: 500_000,
  premium: 1_500_000,
  enterprise: 5_000_000,
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(PaymentAttempt)
    private readonly paymentAttemptRepo: Repository<PaymentAttempt>,
    @InjectRepository(PaymentEvent)
    private readonly paymentEventRepo: Repository<PaymentEvent>,
    @InjectRepository(Community)
    private readonly communityRepo: Repository<Community>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly audit: AuditService,
    private readonly paymentGateway: PaymentGatewayService,
    private readonly config: ConfigService,
  ) {}

  async create(actorId: string, dto: CreateBillingSubscriptionDto) {
    await this.assertCanManage(actorId, dto.communityId);
    const subscription = this.subscriptionRepo.create({
      organisationOrCommunityId: dto.communityId,
      plan: dto.plan,
      status: 'active',
      billingReference: dto.billingReference,
      renewalDate: this.nextRenewalDate(),
    });
    const saved = await this.subscriptionRepo.save(subscription);
    await this.audit.record({
      actorId,
      action: 'billing.create',
      targetId: saved.id,
      metadata: { communityId: dto.communityId, plan: dto.plan },
    });
    return this.get(actorId, saved.id);
  }

  async listByCommunity(actorId: string, communityId: string) {
    await this.assertCanManage(actorId, communityId);
    const subscriptions = await this.subscriptionRepo.find({
      where: { organisationOrCommunityId: communityId },
      order: { createdAt: 'DESC' },
    });
    return subscriptions.map((subscription) => this.present(subscription));
  }

  async get(actorId: string, id: string) {
    const subscription = await this.findOrFail(id);
    await this.assertCanManage(
      actorId,
      subscription.organisationOrCommunityId,
    );
    return this.present(subscription);
  }

  async update(
    actorId: string,
    id: string,
    dto: UpdateBillingSubscriptionDto,
    action = 'billing.update',
  ) {
    const subscription = await this.findOrFail(id);
    await this.assertCanManage(
      actorId,
      subscription.organisationOrCommunityId,
    );
    if (dto.plan !== undefined) {
      subscription.plan = dto.plan;
      subscription.renewalDate = this.nextRenewalDate();
    }
    if (dto.status !== undefined) subscription.status = dto.status;
    const saved = await this.subscriptionRepo.save(subscription);
    await this.audit.record({
      actorId,
      action,
      targetId: id,
      metadata: { plan: dto.plan, status: dto.status },
    });
    return this.present(saved);
  }

  async cancel(actorId: string, id: string) {
    return this.update(actorId, id, { status: 'cancelled' }, 'billing.cancel');
  }

  async initializePayment(actorId: string, dto: InitializePaymentDto) {
    await this.assertCanManage(actorId, dto.communityId);
    if (!this.paymentGateway.isConfigured()) {
      throw new ServiceUnavailableException('Payment provider is not configured');
    }
    const currency = this.currency;
    const amount = PAYMENT_AMOUNTS[dto.plan];
    const email = dto.email?.trim();
    if (this.paymentGateway.provider === 'paystack' && !email) {
      throw new BadRequestException('A payment email is required');
    }

    const reference = `ns-${randomUUID()}`;
    const attempt = this.paymentAttemptRepo.create({
      reference,
      communityId: dto.communityId,
      plan: dto.plan,
      amount,
      currency,
      status: 'pending',
      authorizationUrl: null,
      subscriptionId: null,
      providerResponse: null,
      completedAt: null,
    });
    await this.paymentAttemptRepo.save(attempt);

    const initialization = await this.paymentGateway.initialize({
      reference,
      amount,
      currency,
      ...(email ? { email } : {}),
      ...(this.callbackUrl ? { callbackUrl: this.callbackUrl } : {}),
    });
    attempt.authorizationUrl = initialization.authorizationUrl;
    attempt.providerResponse = initialization as any;
    attempt.status = 'initialized';
    await this.paymentAttemptRepo.save(attempt);
    await this.audit.record({
      actorId,
      action: 'billing.payment_initialized',
      targetId: attempt.id,
      metadata: { reference, communityId: dto.communityId, plan: dto.plan },
    });
    return this.presentAttempt(attempt);
  }

  async verifyPayment(actorId: string, dto: VerifyPaymentDto) {
    const attempt = await this.findPaymentAttempt(dto.reference);
    await this.assertCanManage(actorId, attempt.communityId);
    return this.settlePayment(attempt, actorId);
  }

  async getPayment(actorId: string, reference: string) {
    const attempt = await this.findPaymentAttempt(reference);
    await this.assertCanManage(actorId, attempt.communityId);
    return this.presentAttempt(attempt);
  }

  async handlePaymentWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
    const event = this.paymentGateway.verifyWebhook(rawBody, signature);
    const payload = this.parseWebhookPayload(rawBody);
    const eventId =
      event.id ||
      createHash('sha256').update(rawBody ?? Buffer.alloc(0)).digest('hex');
    const existing = await this.paymentEventRepo.findOne({
      where: { eventId },
    });
    if (existing) return { received: true, duplicate: true };

    const record = this.paymentEventRepo.create({
      eventId,
      event: event.event,
      reference: event.reference ?? null,
      status: event.status ?? null,
      payload,
    });
    try {
      await this.paymentEventRepo.save(record);
    } catch (error) {
      if (this.isDuplicatePaymentEvent(error)) {
        return { received: true, duplicate: true };
      }
      throw error;
    }

    if (event.reference && this.isSuccessEvent(event.event, event.status)) {
      const attempt = await this.paymentAttemptRepo.findOne({
        where: { reference: event.reference },
      });
      if (
        attempt &&
        attempt.reference === event.reference &&
        attempt.status !== 'succeeded'
      ) {
        try {
          await this.settlePayment(attempt, 'payment-webhook');
        } catch (error) {
          this.logger.warn(
            `Payment webhook settlement failed for ${event.reference}: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          );
        }
      }
    }

    return { received: true, duplicate: false };
  }

  private async settlePayment(attempt: PaymentAttempt, actorId: string) {
    if (attempt.status === 'succeeded') return this.presentAttempt(attempt);

    let activation:
      | {
          subscriptionId: string;
          reference: string;
          communityId: string;
          plan: string;
        }
      | undefined;

    const settled = await this.paymentAttemptRepo.manager.transaction(
      async (manager) => {
        const locked = await manager.findOne(PaymentAttempt, {
          where: { id: attempt.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!locked) throw new NotFoundException('Payment attempt not found');
        if (locked.status === 'succeeded') return this.presentAttempt(locked);

        const verification = await this.paymentGateway.verify(locked.reference);
        this.assertVerification(locked, verification);

        if (verification.status !== 'success') {
          locked.status = verification.status;
          locked.providerResponse = verification as any;
          if (verification.status === 'failed') locked.completedAt = new Date();
          const saved = await manager.save(PaymentAttempt, locked);
          return this.presentAttempt(saved);
        }

        let subscription = await manager.findOne(Subscription, {
          where: { billingReference: locked.reference },
        });
        if (!subscription) {
          subscription = manager.create(Subscription, {
            organisationOrCommunityId: locked.communityId,
            plan: locked.plan,
            status: 'active',
            billingReference: locked.reference,
            renewalDate: this.nextRenewalDate(),
          });
        }
        subscription.plan = locked.plan;
        subscription.status = 'active';
        subscription.renewalDate = this.nextRenewalDate();
        subscription.billingReference = locked.reference;
        const savedSubscription = await manager.save(Subscription, subscription);

        locked.status = 'succeeded';
        locked.subscriptionId = savedSubscription.id;
        locked.completedAt = verification.paidAt ?? new Date();
        locked.providerResponse = verification as any;
        const savedAttempt = await manager.save(PaymentAttempt, locked);
        activation = {
          subscriptionId: savedSubscription.id,
          reference: locked.reference,
          communityId: locked.communityId,
          plan: locked.plan,
        };
        return this.presentAttempt(savedAttempt);
      },
    );

    if (activation) {
      await this.audit.record({
        actorId,
        action: 'billing.payment_verified',
        targetId: activation.subscriptionId,
        metadata: {
          reference: activation.reference,
          communityId: activation.communityId,
          plan: activation.plan,
        },
      });
    }
    return settled;
  }

  private assertVerification(
    attempt: PaymentAttempt,
    verification: PaymentVerification,
  ) {
    if (!['success', 'pending', 'failed'].includes(verification.status)) {
      throw new BadRequestException('Payment provider returned an invalid status');
    }
    if (verification.reference !== attempt.reference) {
      throw new BadRequestException(
        'Payment provider reference does not match the payment attempt',
      );
    }
    if (verification.status !== 'success') return;
    if (verification.amount !== undefined && verification.amount !== attempt.amount) {
      throw new BadRequestException(
        'Payment provider amount does not match the payment attempt',
      );
    }
    if (
      verification.currency !== undefined &&
      verification.currency.toUpperCase() !== attempt.currency.toUpperCase()
    ) {
      throw new BadRequestException(
        'Payment provider currency does not match the payment attempt',
      );
    }
    if (this.paymentGateway.provider !== 'demo') {
      if (typeof verification.amount !== 'number') {
        throw new BadRequestException('Payment provider did not return an amount');
      }
      if (!verification.currency) {
        throw new BadRequestException('Payment provider did not return a currency');
      }
    }
  }

  private isDuplicatePaymentEvent(error: unknown) {
    const candidate = error as {
      code?: string;
      message?: string;
      driverError?: {
        code?: string;
        constraint?: string;
        detail?: string;
        message?: string;
      };
    } | null;
    if (!candidate) return false;
    const driver = candidate.driverError ?? {};
    if ((driver.code ?? candidate.code) !== '23505') return false;
    const details = [
      driver.constraint,
      driver.detail,
      driver.message,
      candidate.message,
    ]
      .filter((part): part is string => typeof part === 'string')
      .join(' ');
    return /event_id|payment_events/i.test(details);
  }

  private isSuccessEvent(event: string, status?: string) {
    return (
      SUCCESS_PAYMENT_EVENTS.has(event) && (!status || status === 'success')
    );
  }

  private parseWebhookPayload(rawBody: Buffer | undefined) {
    try {
      return JSON.parse(rawBody?.toString('utf8') || '{}');
    } catch {
      return null;
    }
  }

  private async findPaymentAttempt(reference: string) {
    const attempt = await this.paymentAttemptRepo.findOne({
      where: { reference },
    });
    if (!attempt) throw new NotFoundException('Payment attempt not found');
    return attempt;
  }

  private get currency() {
    return this.config.get<string>('payments.currency') || 'NGN';
  }

  private get callbackUrl() {
    return this.config.get<string>('payments.callbackUrl') || '';
  }

  private nextRenewalDate() {
    const renewal = new Date();
    renewal.setDate(renewal.getDate() + BILLING_PERIOD_DAYS);
    return renewal;
  }

  private async assertCanManage(actorId: string, communityId: string) {
    const community = await this.communityRepo.findOne({
      where: { id: communityId },
    });
    if (!community) throw new NotFoundException('Community not found');
    if (community.adminId === actorId) return;
    const actor = await this.userRepo.findOne({ where: { id: actorId } });
    if (
      actor?.role === UserRole.SUPER_ADMIN ||
      actor?.role === UserRole.MODERATOR
    )
      return;
    throw new ForbiddenException(
      'Only the community admin can manage billing for this community',
    );
  }

  private async findOrFail(id: string) {
    const subscription = await this.subscriptionRepo.findOne({
      where: { id },
      relations: ['organisationOrCommunity'],
    });
    if (!subscription) throw new NotFoundException('Subscription not found');
    return subscription;
  }

  private present(subscription: Subscription) {
    return {
      id: subscription.id,
      communityId: subscription.organisationOrCommunityId,
      communityName: subscription.organisationOrCommunity?.name,
      plan: subscription.plan,
      status: subscription.status,
      renewalDate: subscription.renewalDate,
      billingReference: subscription.billingReference,
      createdAt: subscription.createdAt,
    };
  }

  private presentAttempt(attempt: PaymentAttempt) {
    return {
      id: attempt.id,
      reference: attempt.reference,
      communityId: attempt.communityId,
      plan: attempt.plan,
      amount: attempt.amount,
      currency: attempt.currency,
      status: attempt.status,
      authorizationUrl: attempt.authorizationUrl,
      subscriptionId: attempt.subscriptionId,
      completedAt: attempt.completedAt,
      createdAt: attempt.createdAt,
    };
  }
}
