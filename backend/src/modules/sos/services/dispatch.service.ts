import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

export interface EmergencyDispatchService {
  isEnabled(): boolean;
  sendSms(
    phone: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<{ providerMessageId: string }>;
}

@Injectable()
export class DispatchService implements EmergencyDispatchService {
  private static readonly PROVIDER_ID_KEYS = [
    'providerMessageId',
    'provider_message_id',
    'messageId',
    'message_id',
    'sid',
    'id',
  ];

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return this.driver() === 'sms' && this.isProviderConfigured();
  }

  async sendSms(
    phone: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<{ providerMessageId: string }> {
    const driver = this.driver();

    if (driver === 'off') {
      return { providerMessageId: this.localMessageId(phone, message) };
    }

    if (driver !== 'sms' || !this.isProviderConfigured()) {
      throw new ServiceUnavailableException('SMS provider is not configured.');
    }

    const response = await this.postSms(phone, message, metadata);

    if (!response.ok) {
      throw new ServiceUnavailableException(
        'SMS provider rejected the request.',
      );
    }

    return {
      providerMessageId:
        this.extractProviderMessageId(await this.readJson(response)) ??
        this.localMessageId(phone, message),
    };
  }

  private driver(): string {
    return this.config.get<string>('dispatch.driver')?.trim().toLowerCase() ?? '';
  }

  private isProviderConfigured(): boolean {
    return Boolean(
      this.config.get<string>('dispatch.apiUrl')?.trim() &&
        this.config.get<string>('dispatch.apiKey')?.trim() &&
        this.config.get<string>('dispatch.senderId')?.trim(),
    );
  }

  private async postSms(
    phone: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<Response> {
    const apiUrl = this.config.get<string>('dispatch.apiUrl') as string;
    const apiKey = this.config.get<string>('dispatch.apiKey') as string;
    const senderId = this.config.get<string>('dispatch.senderId') as string;

    try {
      return await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: phone,
          message,
          sender: senderId,
          metadata: metadata ?? {},
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ServiceUnavailableException('SMS provider is unavailable.');
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }

  private extractProviderMessageId(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object') return undefined;

    const root = payload as Record<string, unknown>;
    const data =
      root.data && typeof root.data === 'object'
        ? (root.data as Record<string, unknown>)
        : undefined;

    for (const key of DispatchService.PROVIDER_ID_KEYS) {
      const value = root[key] !== undefined ? root[key] : data?.[key];
      if (typeof value === 'string' && value.trim()) return value;
      if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    }

    return undefined;
  }

  private localMessageId(phone: string, message: string): string {
    return `local-${createHash('sha256')
      .update('dispatch:off\0')
      .update(phone)
      .update('\0')
      .update(message)
      .digest('hex')
      .slice(0, 32)}`;
  }
}
