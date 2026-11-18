import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface OtpDeliveryProvider {
  isConfigured(): boolean;
  sendOtpCode(phone: string, code: string): Promise<void>;
}

@Injectable()
export class SmsOtpService implements OtpDeliveryProvider {
  private readonly logger = new Logger(SmsOtpService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('sms.apiUrl') &&
        this.config.get<string>('sms.apiKey') &&
        this.config.get<string>('sms.senderId'),
    );
  }

  async sendOtpCode(phone: string, code: string): Promise<void> {
    const apiUrl = this.config.get<string>('sms.apiUrl') ?? '';
    const apiKey = this.config.get<string>('sms.apiKey') ?? '';
    const senderId = this.config.get<string>('sms.senderId') ?? '';

    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('SMS provider is not configured.');
    }

    const body = {
      to: phone,
      message: `Your verification code is ${code}.`,
      sender: senderId,
    };

    let response: Response;
    try {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      this.logger.warn('SMS send failed before a response was received');
      throw new ServiceUnavailableException('SMS provider is unavailable.');
    }
    if (!response.ok) {
      this.logger.warn(`SMS send rejected with status ${response.status}`);
      throw new ServiceUnavailableException(
        'SMS provider rejected the request.',
      );
    }
  }
}
