import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CommunityService } from './community.service.js';
import { Community } from './entities/community.entity.js';
import { Responder } from './entities/responder.entity.js';
import { User } from '../identity/entities/user.entity.js';
import { UserRole } from '../identity/interfaces/identity.interface.js';

const polygon = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [3.35, 6.5],
      [3.36, 6.5],
      [3.36, 6.51],
      [3.35, 6.51],
      [3.35, 6.5],
    ],
  ],
};

describe('CommunityService', () => {
  let service: CommunityService;
  let communityRepo: any;
  let responderRepo: any;
  let userRepo: any;
  let manager: any;

  const makeCommunity = () => ({
    id: 'community-1',
    name: 'Yaba',
    boundary: polygon,
    adminId: 'admin-1',
    status: 'active',
    plan: 'standard',
    createdAt: new Date(),
    responders: [],
    admin: { id: 'admin-1', displayName: 'Bola' },
  });

  beforeEach(async () => {
    manager = {
      create: vi.fn((_entity, value) => ({ ...value })),
      save: vi.fn(async (entity, value) => {
        if (entity === Community) return { ...value, id: 'community-1' };
        return value;
      }),
      findOne: vi.fn(async (entity) =>
        entity === User
          ? { id: 'admin-1', role: UserRole.RESIDENT, communityId: null }
          : null,
      ),
    };
    communityRepo = {
      findOne: vi.fn().mockImplementation(async () => makeCommunity()),
      find: vi.fn().mockImplementation(async () => [makeCommunity()]),
      save: vi.fn(async (value) => value),
    };
    responderRepo = {
      findOne: vi.fn().mockResolvedValue(null),
      save: vi.fn(async (value) => value),
      delete: vi.fn(),
    };
    userRepo = {
      findOne: vi
        .fn()
        .mockImplementation(async (options) => {
          if (options?.where?.id === 'admin-1')
            return {
              id: 'admin-1',
              role: UserRole.RESIDENT,
              communityId: null,
            };
          return {
            id: 'user-2',
            role: UserRole.RESIDENT,
            communityId: null,
          };
        }),
      save: vi.fn(async (value) => value),
    };
    const db = { transaction: vi.fn(async (cb) => cb(manager)) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommunityService,
        { provide: getRepositoryToken(Community), useValue: communityRepo },
        { provide: getRepositoryToken(Responder), useValue: responderRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: DataSource, useValue: db },
      ],
    }).compile();

    service = module.get(CommunityService);
  });

  afterEach(() => vi.clearAllMocks());

  it('rejects a polygon ring that is not closed', async () => {
    await expect(
      service.create('admin-1', {
        name: 'Bad',
        boundary: {
          type: 'Polygon',
          coordinates: [
            [
              [3.35, 6.5],
              [3.36, 6.5],
              [3.36, 6.51],
              [3.35, 6.51],
            ],
          ],
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates a community and promotes the creator to admin', async () => {
    const result = await service.create('admin-1', {
      name: 'Yaba',
      boundary: polygon,
    });

    const userSaves = manager.save.mock.calls.filter(
      ([entity]) => entity === User,
    );
    expect(userSaves).toHaveLength(1);
    expect(userSaves[0][1].role).toBe(UserRole.COMMUNITY_ADMIN);
    expect(userSaves[0][1].communityId).toBe('community-1');
    expect(result.id).toBe('community-1');
  });

  it('forbids non-admins from updating a community', async () => {
    await expect(
      service.update('user-9', 'community-1', { name: 'Hijacked' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('adds a responder and upgrades their role', async () => {
    await service.addResponder('admin-1', 'community-1', {
      userId: 'user-2',
      coverageArea: polygon,
    });

    const responderSaves = manager.save.mock.calls.filter(
      ([entity]) => entity === Responder,
    );
    expect(responderSaves).toHaveLength(1);
    const userSaves = manager.save.mock.calls.filter(
      ([entity]) => entity === User,
    );
    expect(userSaves[0][1].role).toBe(UserRole.RESPONDER);
    expect(userSaves[0][1].communityId).toBe('community-1');
  });

  it('transfers admin to another user', async () => {
    manager.findOne.mockResolvedValue({
      id: 'user-2',
      role: UserRole.RESIDENT,
      communityId: null,
    });

    await service.assignAdmin('admin-1', 'community-1', {
      userId: 'user-2',
    });

    const communitySaves = manager.save.mock.calls.filter(
      ([entity]) => entity === Community,
    );
    expect(communitySaves[0][1].adminId).toBe('user-2');
    const userSaves = manager.save.mock.calls.filter(
      ([entity]) => entity === User,
    );
    expect(userSaves[0][1].role).toBe(UserRole.COMMUNITY_ADMIN);
  });
});
