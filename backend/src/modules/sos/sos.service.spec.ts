import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SosService } from './sos.service.js';
import { SOSRequest } from './entities/sos-request.entity.js';
import { SOSRecipient } from './entities/sos-recipient.entity.js';
import { Responder } from '../community/entities/responder.entity.js';
import { Community } from '../community/entities/community.entity.js';
import { User } from '../identity/entities/user.entity.js';
import { NotificationDelivery } from '../notifications/entities/notification-delivery.entity.js';
import { UserRole } from '../identity/interfaces/identity.interface.js';

describe('SosService', () => {
  let service: SosService;
  let sosRepo: any;
  let recipientRepo: any;
  let responderRepo: any;
  let userRepo: any;
  let db: any;
  let manager: any;

  const makeSos = () => ({
    id: 'sos-1',
    requesterId: 'user-1',
    incidentType: 'medical',
    state: 'active',
    locationSnapshot: { type: 'Point', coordinates: [3.37921, 6.52442] },
    sharingPolicy: { scope: 'nearby_responders' },
    escalationPolicy: {},
    createdAt: new Date(),
    recipients: [
      {
        recipientId: 'user-2',
        role: 'responder',
        channel: 'in_app',
        deliveryState: 'delivered',
        acknowledgementState: 'unacknowledged',
        timestamps: {},
        recipient: { displayName: 'Ada' },
      },
    ],
    requester: { id: 'user-1', displayName: 'Tunde' },
  });

  beforeEach(async () => {
    manager = {
      create: vi.fn((_entity, value) => ({ ...value })),
      save: vi.fn(async (entity, value) => {
        if (entity === SOSRequest) return { ...value, id: 'sos-1' };
        return value;
      }),
    };
    sosRepo = {
      findOne: vi.fn().mockImplementation(async () => makeSos()),
      find: vi.fn().mockImplementation(async () => [makeSos()]),
      save: vi.fn(async (value) => value),
    };
    recipientRepo = {
      findOne: vi.fn(),
      find: vi.fn().mockResolvedValue([]),
      save: vi.fn(async (value) => value),
    };
    responderRepo = {
      manager: { query: vi.fn().mockResolvedValue([
        { userId: 'user-2', role: 'responder' },
        { userId: 'user-1', role: 'responder' },
      ]) },
    };
    userRepo = {
      findOne: vi.fn().mockResolvedValue({ id: 'user-1', role: UserRole.RESIDENT }),
    };
    db = {
      transaction: vi.fn(async (cb) => cb(manager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SosService,
        { provide: getRepositoryToken(SOSRequest), useValue: sosRepo },
        { provide: getRepositoryToken(SOSRecipient), useValue: recipientRepo },
        { provide: getRepositoryToken(Responder), useValue: responderRepo },
        { provide: getRepositoryToken(Community), useValue: {} },
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: getRepositoryToken(NotificationDelivery),
          useValue: {},
        },
        { provide: DataSource, useValue: db },
      ],
    }).compile();

    service = module.get(SosService);
  });

  afterEach(() => vi.clearAllMocks());

  it('creates an SOS and notifies nearby recipients but not the requester', async () => {
    const result = await service.create('user-1', {
      incidentType: 'medical',
      latitude: 6.52442,
      longitude: 3.37921,
    });

    expect(responderRepo.manager.query).toHaveBeenCalled();
    const recipientSaves = manager.save.mock.calls.filter(
      ([entity]) => entity === SOSRecipient,
    );
    expect(recipientSaves).toHaveLength(1);
    expect(recipientSaves[0][1].recipientId).toBe('user-2');
    const deliverySaves = manager.save.mock.calls.filter(
      ([entity]) => entity === NotificationDelivery,
    );
    expect(deliverySaves).toHaveLength(1);
    expect(deliverySaves[0][1].payload.sosId).toBe('sos-1');
    expect(result.id).toBe('sos-1');
    expect(result.location.coordinates).toEqual([3.38, 6.52]);
  });

  it('acknowledges an SOS only for a dispatched recipient', async () => {
    recipientRepo.findOne.mockResolvedValue({
      sosId: 'sos-1',
      recipientId: 'user-2',
      acknowledgementState: 'unacknowledged',
      timestamps: {},
    });

    await service.acknowledge('user-2', 'sos-1', 'On my way');

    expect(recipientRepo.save).toHaveBeenCalled();
    const saved = recipientRepo.save.mock.calls[0][0];
    expect(saved.acknowledgementState).toBe('acknowledged');
    expect(saved.timestamps.acknowledgementNote).toBe('On my way');
    expect(sosRepo.save).toHaveBeenCalled();
  });

  it('rejects acknowledgement from a non-recipient', async () => {
    recipientRepo.findOne.mockResolvedValue(null);

    await expect(service.acknowledge('user-9', 'sos-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows the requester to resolve an open SOS', async () => {
    const result = await service.updateState('user-1', 'sos-1', {
      state: 'resolved',
      reason: 'help arrived',
    });

    expect(sosRepo.save).toHaveBeenCalled();
    expect(sosRepo.save.mock.calls[0][0].state).toBe('resolved');
    expect(result.id).toBe('sos-1');
  });

  it('rejects state changes from an unrelated resident', async () => {
    await expect(
      service.updateState('user-9', 'sos-1', { state: 'cancelled' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
