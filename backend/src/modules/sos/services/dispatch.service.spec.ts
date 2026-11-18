import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DispatchService } from './dispatch.service.js';

describe('DispatchService', () => {
  const makeService = (dispatch: Record<string, string>) =>
    new DispatchService(new ConfigService({ dispatch }));

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns a deterministic local id for the off driver without network access', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const service = makeService({ driver: 'off' });

    expect(service.isEnabled()).toBe(false);

    const first = await service.sendSms('+2348012345678', 'Need help');
    const second = await service.sendSms('+2348012345678', 'Need help');

    expect(first.providerMessageId).toMatch(/^local-/);
    expect(second).toEqual(first);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts JSON to the configured provider and returns its message id', async () => {
    const json = vi.fn().mockResolvedValue({ messageId: 'provider-123' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json });
    vi.stubGlobal('fetch', fetchMock);
    const service = makeService({
      driver: 'sms',
      apiUrl: 'https://dispatch.example/sms',
      apiKey: 'secret-key',
      senderId: 'SIGNAL',
    });

    expect(service.isEnabled()).toBe(true);

    await expect(
      service.sendSms('+2348012345678', 'Need help', { sosId: 'sos-1' }),
    ).resolves.toEqual({ providerMessageId: 'provider-123' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://dispatch.example/sms');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bearer secret-key',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      to: '+2348012345678',
      message: 'Need help',
      sender: 'SIGNAL',
      metadata: { sosId: 'sos-1' },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws a generic unavailable error when the provider rejects the request', async () => {
    const json = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, json });
    vi.stubGlobal('fetch', fetchMock);
    const service = makeService({
      driver: 'sms',
      apiUrl: 'https://dispatch.example/sms',
      apiKey: 'secret-key',
      senderId: 'SIGNAL',
    });

    await expect(
      service.sendSms('+2348012345678', 'Need help'),
    ).rejects.toThrow(ServiceUnavailableException);
    await expect(
      service.sendSms('+2348012345678', 'Need help'),
    ).rejects.toThrow('SMS provider rejected the request.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(json).not.toHaveBeenCalled();
  });

  it('throws a generic unavailable error when the transport fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    const service = makeService({
      driver: 'sms',
      apiUrl: 'https://dispatch.example/sms',
      apiKey: 'secret-key',
      senderId: 'SIGNAL',
    });

    await expect(
      service.sendSms('+2348012345678', 'Need help'),
    ).rejects.toThrow(ServiceUnavailableException);
    await expect(
      service.sendSms('+2348012345678', 'Need help'),
    ).rejects.toThrow('SMS provider is unavailable.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('is disabled and refuses to send when the sms driver is unconfigured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const service = makeService({
      driver: 'sms',
      apiUrl: '',
      apiKey: 'secret-key',
      senderId: 'SIGNAL',
    });

    expect(service.isEnabled()).toBe(false);
    await expect(
      service.sendSms('+2348012345678', 'Need help'),
    ).rejects.toThrow('SMS provider is not configured.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
