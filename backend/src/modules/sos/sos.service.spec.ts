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
import { SosState } from './dto/sos.dto.js';
import { DispatchService } from './services/dispatch.service.js';
import { AuditService } from '../audit/audit.service.js';

describe('SosService', () => {
  let service: SosService;
  let sosRepo: any;
  let recipientRepo: any;
  let responderRepo: any;
  let userRepo: any;
  let db: any;
  let manager: any;
  let dispatch: any;
  let audit: any;

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
      query: vi.fn().mockResolvedValue([
        { userId: 'user-2', role: 'responder' },
        { userId: 'user-1', role: 'responder' },
      ]),
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
      manager: {
        query: vi.fn().mockResolvedValue([
          { userId: 'user-2', role: 'responder' },
          { userId: 'user-1', role: 'responder' },
        ]),
      },
    };
    userRepo = {
      find: vi.fn().mockResolvedValue([]),
      findOne: vi
        .fn()
        .mockResolvedValue({ id: 'user-1', role: UserRole.RESIDENT }),
      findOneBy: vi
        .fn()
        .mockResolvedValue({ id: 'user-2', displayName: 'Zainab' }),
    };
    dispatch = {
      isEnabled: vi.fn().mockReturnValue(false),
      sendSms: vi.fn().mockResolvedValue({ providerMessageId: 'provider-1' }),
    };
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    db = {
      transaction: vi.fn(async (cb) => cb(manager)),
      manager,
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
        { provide: DispatchService, useValue: dispatch },
        { provide: AuditService, useValue: audit },
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

    expect(manager.query).toHaveBeenCalled();
    const recipientSaves = manager.save.mock.calls.filter(
      ([entity]: [unknown]) => entity === SOSRecipient,
    );
    expect(recipientSaves).toHaveLength(1);
    expect(recipientSaves[0][1].recipientId).toBe('user-2');
    const deliverySaves = manager.save.mock.calls.filter(
      ([entity]: [unknown]) => entity === NotificationDelivery,
    );
    expect(deliverySaves).toHaveLength(1);
    expect(deliverySaves[0][1].payload.sosId).toBe('sos-1');
    expect(result.id).toBe('sos-1');
    expect((result.location as any).coordinates).toEqual([3.38, 6.52]);
  });

  it('sends an emergency SMS to consenting nearby recipients with a phone', async () => {
    dispatch.isEnabled.mockReturnValue(true);
    userRepo.find.mockResolvedValue([
      {
        id: 'user-2',
        phone: '+2348012345678',
        privacySettings: { showPhone: true },
        locationPreference: { permissionState: 'granted' },
      },
    ]);

    await service.create('user-1', {
      incidentType: 'medical',
      latitude: 6.52442,
      longitude: 3.37921,
      locationLabel: 'Yaba',
      message: 'Need help now',
    });

    expect(userRepo.find).toHaveBeenCalledWith({
      where: { id: expect.anything() },
      relations: ['locationPreference'],
    });
    expect(dispatch.sendSms).toHaveBeenCalledTimes(1);
    const [phone, message, metadata] = dispatch.sendSms.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(phone).toBe('+2348012345678');
    expect(message).toContain('medical');
    expect(message).toContain('Need help now');
    expect(metadata).toMatchObject({
      sosId: 'sos-1',
      recipientId: 'user-2',
      incidentType: 'medical',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sos.emergency_sms.dispatched',
        targetId: 'sos-1',
      }),
    );
  });

  it('does not dispatch SMS when the driver is off', async () => {
    await service.create('user-1', {
      incidentType: 'medical',
      latitude: 6.52442,
      longitude: 3.37921,
    });

    expect(dispatch.isEnabled).toHaveBeenCalled();
    expect(userRepo.find).not.toHaveBeenCalled();
    expect(dispatch.sendSms).not.toHaveBeenCalled();
  });

  it('skips nearby recipients without a phone or emergency SMS consent', async () => {
    dispatch.isEnabled.mockReturnValue(true);
    manager.query.mockResolvedValue([
      { userId: 'user-2', role: 'responder' },
      { userId: 'user-3', role: 'responder' },
      { userId: 'user-4', role: 'responder' },
      { userId: 'user-5', role: 'community_admin' },
    ]);
    userRepo.find.mockResolvedValue([
      {
        id: 'user-2',
        phone: '',
        privacySettings: { showPhone: true },
      },
      {
        id: 'user-3',
        phone: '+2348012345679',
        privacySettings: { showPhone: false },
      },
      {
        id: 'user-4',
        phone: '+2348012345680',
        privacySettings: { showPhone: true },
        locationPreference: { permissionState: 'denied' },
      },
      {
        id: 'user-5',
        phone: '+2348012345681',
      },
    ]);

    await service.create('user-1', {
      incidentType: 'medical',
      latitude: 6.52442,
      longitude: 3.37921,
    });

    expect(dispatch.sendSms).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('keeps SOS creation successful and audits a failed SMS dispatch', async () => {
    dispatch.isEnabled.mockReturnValue(true);
    dispatch.sendSms.mockRejectedValue(new Error('provider down'));
    userRepo.find.mockResolvedValue([
      {
        id: 'user-2',
        phone: '+2348012345678',
        privacySettings: { emergencySms: true },
      },
    ]);

    await expect(
      service.create('user-1', {
        incidentType: 'medical',
        latitude: 6.52442,
        longitude: 3.37921,
      }),
    ).resolves.toMatchObject({ id: 'sos-1' });

    expect(dispatch.sendSms).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sos.emergency_sms.failed',
        targetId: 'sos-1',
        metadata: expect.objectContaining({ reason: 'provider down' }),
      }),
    );
  });

  it('keeps SOS creation successful when recipient lookup for dispatch fails', async () => {
    dispatch.isEnabled.mockReturnValue(true);
    userRepo.find.mockRejectedValue(new Error('lookup down'));

    await expect(
      service.create('user-1', {
        incidentType: 'medical',
        latitude: 6.52442,
        longitude: 3.37921,
      }),
    ).resolves.toMatchObject({ id: 'sos-1' });

    expect(dispatch.sendSms).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sos.emergency_sms.failed',
        metadata: expect.objectContaining({ reason: 'lookup down' }),
      }),
    );
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
      state: SosState.RESOLVED,
      reason: 'help arrived',
    });

    expect(sosRepo.save).toHaveBeenCalled();
    expect(sosRepo.save.mock.calls[0][0].state).toBe('resolved');
    expect(result.id).toBe('sos-1');
  });

  it('rejects state changes from an unrelated resident', async () => {
    await expect(
      service.updateState('user-9', 'sos-1', { state: SosState.CANCELLED }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
