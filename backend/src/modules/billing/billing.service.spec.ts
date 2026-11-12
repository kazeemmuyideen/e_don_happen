import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { BillingService } from './billing.service.js';
import { Subscription } from './entities/subscription.entity.js';
import { Community } from '../community/entities/community.entity.js';
import { User } from '../identity/entities/user.entity.js';
import { UserRole } from '../identity/interfaces/identity.interface.js';

describe('BillingService', () => {
  let service: BillingService;
  let subscriptionRepo: any;
  let communityRepo: any;
  let userRepo: any;

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

  beforeEach(async () => {
    subscriptionRepo = {
      create: vi.fn((value) => ({ ...value })),
      save: vi.fn(async (value) => ({ ...value, id: 'sub-1' })),
      findOne: vi.fn().mockImplementation(async () => makeSubscription()),
      find: vi.fn().mockImplementation(async () => [makeSubscription()]),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        {
          provide: getRepositoryToken(Subscription),
          useValue: subscriptionRepo,
        },
        { provide: getRepositoryToken(Community), useValue: communityRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
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
});
