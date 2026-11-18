import { createHmac } from 'node:crypto';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentGatewayService } from './payment-gateway.service.js';

const makeService = (
  payments: Record<string, unknown> = {},
  nodeEnv?: string,
) =>
  new PaymentGatewayService(
    new ConfigService({
      payments,
      ...(nodeEnv ? { NODE_ENV: nodeEnv } : {}),
    }),
  );

describe('PaymentGatewayService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the demo provider without making network calls', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const service = makeService({ provider: 'demo' });

    expect(service.isConfigured()).toBe(true);
    await expect(
      service.initialize({ reference: 'ref-1', amount: 2500 }),
    ).resolves.toEqual({
      authorizationUrl: 'https://pay.local/demo/ref-1',
      reference: 'ref-1',
    });
    await expect(service.verify('ref-1')).resolves.toEqual({
      status: 'success',
      reference: 'ref-1',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('initializes a paystack transaction with bearer authentication', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: true,
        data: {
          authorization_url: 'https://checkout.paystack.local/ref-1',
          access_code: 'access-1',
          reference: 'ref-1',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = makeService({
      provider: 'paystack',
      baseUrl: 'https://api.paystack.co',
      secretKey: 'sk_test_secret',
      currency: 'NGN',
    });

    const result = await service.initialize({
      reference: 'ref-1',
      amount: 5000,
      email: 'resident@example.com',
      callbackUrl: 'https://app.local/payments/callback',
    });

    expect(result).toEqual({
      authorizationUrl: 'https://checkout.paystack.local/ref-1',
      accessCode: 'access-1',
      reference: 'ref-1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.paystack.co/transaction/initialize');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer sk_test_secret');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(options.body)).toEqual({
      email: 'resident@example.com',
      amount: 5000,
      currency: 'NGN',
      reference: 'ref-1',
      callback_url: 'https://app.local/payments/callback',
    });
  });

  it('verifies a paystack transaction and maps its status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: true,
        data: {
          status: 'success',
          reference: 'ref/1',
          amount: 5000,
          currency: 'NGN',
          paid_at: '2026-01-02T03:04:05.000Z',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = makeService({
      provider: 'paystack',
      baseUrl: 'https://api.paystack.co',
      secretKey: 'sk_test_secret',
    });

    const result = await service.verify('ref/1');

    expect(result).toEqual({
      status: 'success',
      reference: 'ref/1',
      amount: 5000,
      currency: 'NGN',
      paidAt: new Date('2026-01-02T03:04:05.000Z'),
    });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.paystack.co/transaction/verify/ref%2F1');
    expect(options.method).toBe('GET');
    expect(options.headers.Authorization).toBe('Bearer sk_test_secret');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps abandoned transactions to failed and surfaces transport errors', async () => {
    const service = makeService({
      provider: 'paystack',
      secretKey: 'sk_test_secret',
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: true,
        data: { status: 'abandoned', reference: 'ref-2' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(service.verify('ref-2')).resolves.toEqual({
      status: 'failed',
      reference: 'ref-2',
    });

    fetchMock.mockRejectedValueOnce(new Error('network offline'));
    await expect(service.verify('ref-2')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('accepts valid webhook signatures and rejects invalid ones', () => {
    const service = makeService({
      provider: 'paystack',
      webhookSecret: 'webhook_secret',
    });
    const rawBody = Buffer.from(
        JSON.stringify({
          id: 'evt-3',
          event: 'charge.success',
          data: { reference: 'ref-3', status: 'success' },
        }),
    );
    const signature = createHmac('sha256', 'webhook_secret')
      .update(rawBody)
      .digest('hex');

    expect(service.verifyWebhook(rawBody, signature)).toEqual({
      id: 'evt-3',
      event: 'charge.success',
      reference: 'ref-3',
      status: 'success',
    });
    expect(service.verifyWebhook(rawBody, `sha256=${signature}`)).toEqual({
      id: 'evt-3',
      event: 'charge.success',
      reference: 'ref-3',
      status: 'success',
    });
    expect(() => service.verifyWebhook(rawBody, 'deadbeef')).toThrow(
      UnauthorizedException,
    );
    expect(() => service.verifyWebhook(rawBody, undefined)).toThrow(
      UnauthorizedException,
    );
  });

  it('requires a webhook secret in production', () => {
    const service = makeService(
      { provider: 'paystack', webhookSecret: '' },
      'production',
    );

    expect(() =>
      service.verifyWebhook(Buffer.from('{}'), 'anything'),
    ).toThrow(ServiceUnavailableException);
  });

  it('skips webhook verification without a secret outside production', () => {
    const service = makeService({ provider: 'demo', webhookSecret: '' }, 'test');
    const rawBody = Buffer.from(
      JSON.stringify({
        event: 'charge.pending',
        data: { reference: 'ref-4', status: 'pending' },
      }),
    );

    expect(service.verifyWebhook(rawBody, undefined)).toEqual({
      event: 'charge.pending',
      reference: 'ref-4',
      status: 'pending',
    });
  });
});
