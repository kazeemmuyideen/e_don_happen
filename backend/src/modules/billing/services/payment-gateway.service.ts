import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface PaymentInitializeInput {
  reference: string;
  amount: number;
  currency?: string;
  email?: string;
  callbackUrl?: string;
}

export interface PaymentInitialization {
  authorizationUrl: string;
  accessCode?: string;
  reference: string;
}

export type PaymentVerificationStatus = 'success' | 'pending' | 'failed';

export interface PaymentVerification {
  status: PaymentVerificationStatus;
  reference: string;
  amount?: number;
  currency?: string;
  paidAt?: Date;
}

export interface PaymentWebhookEvent {
  id?: string;
  event: string;
  reference?: string;
  status?: string;
}

interface PaystackInitializePayload {
  status?: boolean;
  data?: {
    authorization_url?: string;
    access_code?: string;
    reference?: string;
  };
}

interface PaystackVerifyPayload {
  status?: boolean;
  data?: {
    status?: string;
    reference?: string;
    amount?: number;
    currency?: string;
    paid_at?: string | null;
  };
}

interface WebhookPayload {
  id?: unknown;
  event?: unknown;
  reference?: unknown;
  status?: unknown;
  data?: WebhookPayload;
}

@Injectable()
export class PaymentGatewayService {
  private static readonly TIMEOUT_MS = 10_000;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    const provider = this.provider;
    if (provider === 'demo') return true;
    if (provider !== 'paystack') return false;
    return Boolean(this.secretKey);
  }

  async initialize(input: PaymentInitializeInput): Promise<PaymentInitialization> {
    if (this.provider === 'demo') {
      return {
        authorizationUrl: `https://pay.local/demo/${input.reference}`,
        reference: input.reference,
      };
    }

    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Payment provider is not configured.',
      );
    }

    try {
      const response = await fetch(`${this.baseUrl}/transaction/initialize`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: input.email,
          amount: input.amount,
          currency: input.currency ?? this.currency,
          reference: input.reference,
          ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
        }),
        signal: AbortSignal.timeout(PaymentGatewayService.TIMEOUT_MS),
      });
      if (!response.ok) throw new Error('Payment provider rejected the request');

      const payload = (await response.json()) as PaystackInitializePayload;
      if (payload.status === false || !payload.data?.authorization_url) {
        throw new Error('Payment provider returned an invalid response');
      }

      return {
        authorizationUrl: payload.data.authorization_url,
        ...(payload.data.access_code
          ? { accessCode: payload.data.access_code }
          : {}),
        reference: payload.data.reference || input.reference,
      };
    } catch {
      throw new ServiceUnavailableException('Payment provider is unavailable.');
    }
  }

  async verify(reference: string): Promise<PaymentVerification> {
    if (this.provider === 'demo') {
      return { status: 'success', reference };
    }

    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Payment provider is not configured.',
      );
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/transaction/verify/${encodeURIComponent(reference)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.secretKey}` },
          signal: AbortSignal.timeout(PaymentGatewayService.TIMEOUT_MS),
        },
      );
      if (!response.ok) throw new Error('Payment provider rejected the request');

      const payload = (await response.json()) as PaystackVerifyPayload;
      if (payload.status === false || !payload.data) {
        throw new Error('Payment provider returned an invalid response');
      }

      const paidAt = this.parseDate(payload.data.paid_at);
      return {
        status: this.mapStatus(payload.data.status),
        reference: payload.data.reference || reference,
        ...(typeof payload.data.amount === 'number'
          ? { amount: payload.data.amount }
          : {}),
        ...(typeof payload.data.currency === 'string'
          ? { currency: payload.data.currency }
          : {}),
        ...(paidAt ? { paidAt } : {}),
      };
    } catch {
      throw new ServiceUnavailableException('Payment provider is unavailable.');
    }
  }

  verifyWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): PaymentWebhookEvent {
    const secret = this.webhookSecret;
    if (!secret) {
      if (this.isProduction()) {
        throw new ServiceUnavailableException(
          'Payment webhook secret is not configured.',
        );
      }
      return this.parseWebhook(rawBody);
    }

    const expected = createHmac('sha256', secret)
      .update(rawBody ?? Buffer.alloc(0))
      .digest('hex');
    const received = signature?.replace(/^sha256=/, '') ?? '';
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const receivedBuffer = Buffer.from(received, 'utf8');
    if (
      expectedBuffer.length !== receivedBuffer.length ||
      !timingSafeEqual(expectedBuffer, receivedBuffer)
    ) {
      throw new UnauthorizedException('Invalid payment webhook signature.');
    }

    return this.parseWebhook(rawBody);
  }

  get provider(): string {
    return this.config.get<string>('payments.provider') || 'demo';
  }

  private get baseUrl(): string {
    return (
      this.config.get<string>('payments.baseUrl') || 'https://api.paystack.co'
    ).replace(/\/+$/, '');
  }

  private get secretKey(): string | undefined {
    return this.config.get<string>('payments.secretKey');
  }

  private get webhookSecret(): string | undefined {
    return this.config.get<string>('payments.webhookSecret');
  }

  private get currency(): string {
    return this.config.get<string>('payments.currency') || 'NGN';
  }

  private isProduction(): boolean {
    return (
      this.config.get<string>('NODE_ENV') === 'production' ||
      this.config.get<string>('environment') === 'production'
    );
  }

  private mapStatus(status: string | undefined): PaymentVerificationStatus {
    switch (status) {
      case 'success':
        return 'success';
      case 'pending':
        return 'pending';
      case 'abandoned':
      case 'failed':
        return 'failed';
      default:
        return 'failed';
    }
  }

  private parseDate(value: string | null | undefined): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  private parseWebhook(rawBody: Buffer | undefined): PaymentWebhookEvent {
    let payload: WebhookPayload;
    try {
      payload = JSON.parse(rawBody?.toString('utf8') || '{}') as WebhookPayload;
    } catch {
      return { event: 'unknown' };
    }

    const data = payload.data ?? {};
    const id =
      typeof payload.id === 'string'
        ? payload.id
        : typeof data.id === 'string'
          ? data.id
          : undefined;
    const event =
      typeof payload.event === 'string' ? payload.event : 'unknown';
    const reference =
      typeof data.reference === 'string'
        ? data.reference
        : typeof payload.reference === 'string'
          ? payload.reference
          : undefined;
    const status =
      typeof data.status === 'string'
        ? data.status
        : typeof payload.status === 'string'
          ? payload.status
          : undefined;

    return {
      ...(id ? { id } : {}),
      event,
      ...(reference ? { reference } : {}),
      ...(status ? { status } : {}),
    };
  }
}
