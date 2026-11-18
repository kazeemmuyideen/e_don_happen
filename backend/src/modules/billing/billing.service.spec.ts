import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BillingService } from './billing.service.js';
import { Subscription } from './entities/subscription.entity.js';
import { PaymentAttempt } from './entities/payment-attempt.entity.js';
import { PaymentEvent } from './entities/payment-event.entity.js';
import { Community } from '../community/entities/community.entity.js';
import { User } from '../identity/entities/user.entity.js';
import { UserRole } from '../identity/interfaces/identity.interface.js';
import { PaymentGatewayService } from './services/payment-gateway.service.js';
import { AuditService } from '../audit/audit.service.js';

describe('BillingService', () => {
  let service: BillingService;
  let subscriptionRepo: any;
  let paymentAttemptRepo: any;
  let paymentEventRepo: any;
  let communityRepo: any;
  let userRepo: any;
  let paymentGateway: any;
  let audit: any;
  let manager: any;

  const makeSubscription = () => ({
    id: 'sub-1',
    organisationOrCommunityId: 'community-1',
    plan: 'premium',
    status: 'active',
    renewalDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    billingReference: 'ref-1',
    createdAt: new Date(),
    organisationOrCommunity: { name: 'Yaba' },
  });

  const makeAttempt = () => ({
    id: 'attempt-1',
    reference: 'ns-1',
    communityId: 'community-1',
    plan: 'premium',
    amount: 1_500_000,
    currency: 'NGN',
    status: 'initialized',
    authorizationUrl: 'https://pay.local/ns-1',
    subscriptionId: null,
    providerResponse: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(async () => {
    subscriptionRepo = {
      create: vi.fn((value) => ({ ...value })),
      save: vi.fn(async (value) => ({ ...value, id: 'sub-1' })),
      findOne: vi.fn().mockImplementation(async () => makeSubscription()),
      find: vi.fn().mockImplementation(async () => [makeSubscription()]),
    };
    paymentAttemptRepo = {
      create: vi.fn((value) => ({ ...value })),
      save: vi.fn(async (value) => ({ ...value, id: 'attempt-1' })),
      findOne: vi.fn().mockImplementation(async () => makeAttempt()),
    };
    paymentEventRepo = {
      create: vi.fn((value) => ({ ...value })),
      save: vi.fn(async (value) => ({ ...value, id: 'event-1' })),
      findOne: vi.fn().mockResolvedValue(null),
    };
    manager = {
      findOne: vi.fn(async (entity: any, options: any) =>
        entity === PaymentAttempt ? makeAttempt() : subscriptionRepo.findOne(options),
      ),
      create: vi.fn((_entity: any, value: any) => ({ ...value })),
      save: vi.fn(async (entity: any, value: any) =>
        entity === PaymentAttempt
          ? paymentAttemptRepo.save(value)
          : subscriptionRepo.save(value),
      ),
    };
    paymentAttemptRepo.manager = {
      transaction: vi.fn(async (work: any) => work(manager)),
    };
    communityRepo = {
      findOne: vi.fn().mockResolvedValue({
        id: 'community-1',
        adminId: 'admin-1',
        name: 'Yaba',
      }),
    };
    userRepo = {
      findOne: vi.fn().mockResolvedValue({
        id: 'user-9',
        role: UserRole.RESIDENT,
      }),
    };
    paymentGateway = {
      provider: 'demo',
      isConfigured: vi.fn().mockReturnValue(true),
      initialize: vi.fn(async (input: any) => ({
        authorizationUrl: `https://pay.local/${input.reference}`,
        reference: input.reference,
      })),
      verify: vi.fn(async (reference: string) => ({
        status: 'success',
        reference,
        paidAt: new Date(),
      })),
      verifyWebhook: vi.fn().mockReturnValue({
        id: 'evt-1',
        event: 'charge.success',
        reference: 'ns-1',
        status: 'success',
      }),
    };
    audit = { record: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        {
          provide: getRepositoryToken(Subscription),
          useValue: subscriptionRepo,
        },
        {
          provide: getRepositoryToken(PaymentAttempt),
          useValue: paymentAttemptRepo,
        },
        {
          provide: getRepositoryToken(PaymentEvent),
          useValue: paymentEventRepo,
        },
        { provide: getRepositoryToken(Community), useValue: communityRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: PaymentGatewayService, useValue: paymentGateway },
        { provide: AuditService, useValue: audit },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            payments: { provider: 'demo', currency: 'NGN' },
          }),
        },
      ],
    }).compile();

    service = module.get(BillingService);
  });

  afterEach(() => vi.clearAllMocks());

  it('creates an active subscription with a 30 day renewal window', async () => {
    const result = await service.create('admin-1', {
      communityId: 'community-1',
      plan: 'premium',
      billingReference: 'ref-1',
    });

    const saved = subscriptionRepo.save.mock.calls[0][0];
    expect(saved.status).toBe('active');
    const days =
      (saved.renewalDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThanOrEqual(30);
    expect(result.id).toBe('sub-1');
  });

  it('forbids residents from managing community billing', async () => {
    await expect(
      service.create('user-9', {
        communityId: 'community-1',
        plan: 'standard',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('cancels a subscription', async () => {
    const result = await service.cancel('admin-1', 'sub-1');

    expect(subscriptionRepo.save).toHaveBeenCalled();
    expect(subscriptionRepo.save.mock.calls[0][0].status).toBe('cancelled');
    expect(result.id).toBe('sub-1');
  });

  it('lists subscriptions for a community the actor administers', async () => {
    const result = await service.listByCommunity('admin-1', 'community-1');

    expect(result).toHaveLength(1);
    expect(result[0].communityName).toBe('Yaba');
  });

  it('initializes a payment with a server-side amount', async () => {
    const result = await service.initializePayment('admin-1', {
      communityId: 'community-1',
      plan: 'premium',
    });

    expect(paymentGateway.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1_500_000,
        currency: 'NGN',
      }),
    );
    expect(paymentAttemptRepo.save).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('initialized');
    expect(result.authorizationUrl).toBe(`https://pay.local/${result.reference}`);
  });

  it('settles a verified payment and activates the subscription', async () => {
    subscriptionRepo.findOne.mockResolvedValueOnce(null);

    const result = await service.verifyPayment('admin-1', {
      reference: 'ns-1',
    });

    expect(paymentGateway.verify).toHaveBeenCalledWith('ns-1');
    expect(subscriptionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'active',
        billingReference: 'ns-1',
      }),
    );
    expect(result.status).toBe('succeeded');
    expect(result.subscriptionId).toBe('sub-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.payment_verified' }),
    );
  });

  it('records payment webhooks once', async () => {
    paymentEventRepo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'event-1' });

    const first = await service.handlePaymentWebhook(
      Buffer.from('{"event":"charge.success"}'),
      'signature',
    );
    const second = await service.handlePaymentWebhook(
      Buffer.from('{"event":"charge.success"}'),
      'signature',
    );

    expect(first).toEqual({ received: true, duplicate: false });
    expect(second).toEqual({ received: true, duplicate: true });
    expect(paymentEventRepo.save).toHaveBeenCalledTimes(1);
  });

  it('treats a unique event_id violation as a duplicate webhook', async () => {
    paymentEventRepo.save
      .mockResolvedValueOnce({ id: 'event-1' })
      .mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), {
          code: '23505',
          driverError: {
            code: '23505',
            constraint: 'UQ_payment_events_event_id',
            detail: 'Key (event_id)=(evt-1) already exists.',
          },
        }),
      );

    const first = await service.handlePaymentWebhook(
      Buffer.from('{"event":"charge.success"}'),
      'signature',
    );
    const second = await service.handlePaymentWebhook(
      Buffer.from('{"event":"charge.success"}'),
      'signature',
    );

    expect(first).toEqual({ received: true, duplicate: false });
    expect(second).toEqual({ received: true, duplicate: true });
    expect(paymentEventRepo.save).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['amount', { amount: 500_000, currency: 'NGN' }],
    ['currency', { amount: 1_500_000, currency: 'USD' }],
  ])(
    'rejects a provider response with a mismatched %s',
    async (_field, verification) => {
      paymentGateway.provider = 'paystack';
      paymentGateway.verify.mockResolvedValue({
        status: 'success',
        reference: 'ns-1',
        ...verification,
      });

      await expect(
        service.verifyPayment('admin-1', { reference: 'ns-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(subscriptionRepo.save).not.toHaveBeenCalled();
      expect(paymentAttemptRepo.save).not.toHaveBeenCalled();
    },
  );
});
