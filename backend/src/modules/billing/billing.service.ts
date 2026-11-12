import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription } from './entities/subscription.entity.js';
import { Community } from '../community/entities/community.entity.js';
import { User } from '../identity/entities/user.entity.js';
import { UserRole } from '../identity/interfaces/identity.interface.js';
import {
  CreateBillingSubscriptionDto,
  UpdateBillingSubscriptionDto,
} from './dto/billing.dto.js';

const BILLING_PERIOD_DAYS = 30;

@Injectable()
export class BillingService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(Community)
    private readonly communityRepo: Repository<Community>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
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

  async update(actorId: string, id: string, dto: UpdateBillingSubscriptionDto) {
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
    return this.present(saved);
  }

  async cancel(actorId: string, id: string) {
    return this.update(actorId, id, { status: 'cancelled' });
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
}
