import { ConfigService } from '@nestjs/config';
import { SosEscalationService } from './sos-escalation.service.js';

describe('SosEscalationService', () => {
  const now = new Date('2026-01-01T12:00:00.000Z');

  function setup(enabled = true) {
    const config = new ConfigService({
      sos: {
        escalationEnabled: enabled,
        escalationPollMs: 60_000,
        escalationMaxLevels: 3,
      },
    });
    const sosRepo = { find: vi.fn().mockResolvedValue([] as any[]) };
    const recipientRepo = { existsBy: vi.fn().mockResolvedValue(false) };
    const eventRepo = {
      existsBy: vi.fn().mockResolvedValue(false),
      create: vi.fn((value: any) => value),
      save: vi.fn(async (value: any) => value),
    };
    const deliveryRepo = {
      create: vi.fn((value: any) => value),
      save: vi.fn(async (value: any) => value),
    };
    const service = new SosEscalationService(
      sosRepo as any,
      recipientRepo as any,
      eventRepo as any,
      deliveryRepo as any,
      config,
    );
    return { service, sosRepo, recipientRepo, eventRepo, deliveryRepo };
  }

  function makeSos(overrides: Record<string, unknown> = {}) {
    return {
      id: 'sos-1',
      requesterId: 'requester-1',
      incidentType: 'medical',
      state: 'active',
      createdAt: new Date(now.getTime() - 60 * 60_000),
      escalationPolicy: { escalateAfterMinutes: 15 },
      ...overrides,
    };
  }

  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    ctx = setup();
  });

  it('does nothing when escalation is disabled', async () => {
    const disabled = setup(false);
    await expect(disabled.service.runOnce(now)).resolves.toBe(0);
    expect(disabled.sosRepo.find).not.toHaveBeenCalled();
    expect(disabled.eventRepo.save).not.toHaveBeenCalled();
  });

  it('returns zero when no SOS request is due', async () => {
    ctx.sosRepo.find.mockResolvedValue([makeSos({ createdAt: now })]);
    await expect(ctx.service.runOnce(now)).resolves.toBe(0);
    expect(ctx.eventRepo.existsBy).not.toHaveBeenCalled();
    expect(ctx.eventRepo.save).not.toHaveBeenCalled();
    expect(ctx.deliveryRepo.save).not.toHaveBeenCalled();
  });

  it('skips requests with an acknowledged recipient', async () => {
    ctx.sosRepo.find.mockResolvedValue([makeSos()]);
    ctx.recipientRepo.existsBy.mockResolvedValue(true);
    await expect(ctx.service.runOnce(now)).resolves.toBe(0);
    expect(ctx.recipientRepo.existsBy).toHaveBeenCalledWith({
      sosId: 'sos-1',
      acknowledgementState: 'acknowledged',
    });
    expect(ctx.eventRepo.existsBy).not.toHaveBeenCalled();
    expect(ctx.eventRepo.save).not.toHaveBeenCalled();
  });

  it('creates an event and a requester notification for each due level', async () => {
    ctx.sosRepo.find.mockResolvedValue([
      makeSos({ escalationPolicy: { escalateAfterMinutes: 15, maxLevels: 2 } }),
    ]);

    await expect(ctx.service.runOnce(now)).resolves.toBe(2);

    expect(ctx.eventRepo.save).toHaveBeenCalledTimes(2);
    const first = ctx.eventRepo.save.mock.calls[0][0];
    expect(first).toMatchObject({
      sosId: 'sos-1',
      level: 1,
      firedAt: now,
      channel: 'in_app',
      recipientId: 'requester-1',
      outcome: 'notified',
    });
    expect(first.dueAt).toEqual(new Date(now.getTime() - 45 * 60_000));
    expect(ctx.deliveryRepo.save).toHaveBeenCalledTimes(2);
    expect(ctx.deliveryRepo.save.mock.calls[1][0]).toMatchObject({
      recipientId: 'requester-1',
      channel: 'in_app',
      payload: {
        sosId: 'sos-1',
        level: 2,
        title: expect.any(String),
        body: expect.any(String),
      },
    });
  });

  it('skips levels already recorded as events regardless of firedAt', async () => {
    ctx.sosRepo.find.mockResolvedValue([
      makeSos({ escalationPolicy: { escalateAfterMinutes: 15, maxLevels: 2 } }),
    ]);
    ctx.eventRepo.existsBy.mockResolvedValue(true);

    await expect(ctx.service.runOnce(now)).resolves.toBe(0);

    expect(ctx.eventRepo.existsBy).toHaveBeenCalledWith({
      sosId: 'sos-1',
      level: 1,
    });
    expect(ctx.eventRepo.existsBy).toHaveBeenCalledWith({
      sosId: 'sos-1',
      level: 2,
    });
    for (const [query] of ctx.eventRepo.existsBy.mock.calls) {
      expect(query).not.toHaveProperty('firedAt');
    }
    expect(ctx.eventRepo.save).not.toHaveBeenCalled();
    expect(ctx.deliveryRepo.save).not.toHaveBeenCalled();
  });

  it('does not start a timer when escalation is disabled', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    try {
      const disabled = setup(false);
      disabled.service.onModuleInit();
      disabled.service.onApplicationShutdown();
      expect(setIntervalSpy).not.toHaveBeenCalled();
      expect(clearIntervalSpy).not.toHaveBeenCalled();
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });

  it('starts an unrefd poll timer only when enabled and clears it on shutdown', () => {
    const fakeTimer = { unref: vi.fn() } as unknown as NodeJS.Timeout;
    const setIntervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockReturnValue(fakeTimer);
    const clearIntervalSpy = vi
      .spyOn(globalThis, 'clearInterval')
      .mockImplementation(() => {});
    try {
      ctx.service.onModuleInit();
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      expect(fakeTimer.unref).toHaveBeenCalledTimes(1);
      ctx.service.onApplicationShutdown();
      expect(clearIntervalSpy).toHaveBeenCalledWith(fakeTimer);
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });
});
