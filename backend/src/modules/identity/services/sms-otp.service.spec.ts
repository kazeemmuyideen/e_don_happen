import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsOtpService } from './sms-otp.service.js';

const phone = '+2348000000001';
const code = '123456';
const smsConfig = {
  apiUrl: 'https://sms.example.test/send',
  apiKey: 'test-api-key',
  senderId: 'SIGNAL',
};

describe('SmsOtpService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requires every SMS setting before sending', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    expect(makeService().isConfigured()).toBe(true);
    expect(makeService({ apiUrl: '' }).isConfigured()).toBe(false);
    expect(makeService({ apiKey: '' }).isConfigured()).toBe(false);
    expect(makeService({ senderId: '' }).isConfigured()).toBe(false);

    await expect(
      makeService({ apiKey: '' }).sendOtpCode(phone, code),
    ).rejects.toMatchObject({
      status: 503,
      message: 'SMS provider is not configured.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the code to the configured provider', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await makeService().sendOtpCode(phone, code);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe(smsConfig.apiUrl);
    expect(request?.method).toBe('POST');
    expect(request?.headers).toEqual({
      Authorization: `Bearer ${smsConfig.apiKey}`,
      'Content-Type': 'application/json',
    });
    expect(request?.signal).toBeInstanceOf(AbortSignal);
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    const body = JSON.parse(request?.body as string);
    expect(body.to).toBe(phone);
    expect(body.sender).toBe(smsConfig.senderId);
    expect(body.message).toContain(code);
    expect(`${body.to}${body.sender}`).not.toContain(code);
  });

  it('surfaces a provider rejection as a generic 503', async () => {
    const warnSpy = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ error: `rejected ${phone} ${code}` }), {
          status: 400,
        }),
      ),
    );

    await expect(
      makeService().sendOtpCode(phone, code),
    ).rejects.toMatchObject({
      status: 503,
      message: 'SMS provider rejected the request.',
    });
    const logged = warnSpy.mock.calls.flat().join(' ');
    expect(logged).not.toContain(phone);
    expect(logged).not.toContain(code);
  });

  it('surfaces a transport failure as a generic 503', async () => {
    const warnSpy = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(
        new Error(`connection failed for ${phone} with ${code}`),
      ),
    );

    await expect(
      makeService().sendOtpCode(phone, code),
    ).rejects.toMatchObject({
      status: 503,
      message: 'SMS provider is unavailable.',
    });
    const logged = warnSpy.mock.calls.flat().join(' ');
    expect(logged).not.toContain(phone);
    expect(logged).not.toContain(code);
  });
});

function makeService(overrides: Partial<typeof smsConfig> = {}) {
  return new SmsOtpService(
    new ConfigService({
      sms: { ...smsConfig, ...overrides },
    }),
  );
}
