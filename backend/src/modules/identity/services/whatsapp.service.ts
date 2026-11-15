import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured() {
    return Boolean(
      this.config.get<string>('WHATSAPP_ACCESS_TOKEN') &&
      this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID'),
    );
  }

  async sendOtpCode(phone: string, code: string) {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'WhatsApp provider is not configured.',
      );
    }
    const version = this.config.get<string>('WHATSAPP_API_VERSION') || 'v21.0';
    const phoneNumberId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const template = this.config.get<string>('WHATSAPP_TEMPLATE_NAME');
    const language =
      this.config.get<string>('WHATSAPP_TEMPLATE_LANGUAGE') || 'en_US';
    if (!template) {
      throw new ServiceUnavailableException(
        'WhatsApp OTP template is not configured.',
      );
    }
    const to = phone.replace(/\D/g, '');
    const body = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: template,
        language: { code: language },
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: code }],
          },
        ],
      },
    };
    let response: Response;
    try {
      response = await fetch(
        `https://graph.facebook.com/${version}/${phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.get<string>('WHATSAPP_ACCESS_TOKEN')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      this.logger.warn('WhatsApp send failed before a response was received');
      throw new ServiceUnavailableException(
        'WhatsApp provider is unavailable.',
      );
    }
    if (!response.ok) {
      this.logger.warn(`WhatsApp send rejected with status ${response.status}`);
      throw new ServiceUnavailableException(
        'WhatsApp provider rejected the request.',
      );
    }
  }

  verifySignature(rawBody: Buffer | undefined, signature: string | undefined) {
    const secret = this.config.get<string>('WHATSAPP_APP_SECRET');
    if (!secret) {
      if (this.config.get('NODE_ENV') === 'production') {
        throw new ServiceUnavailableException(
          'WhatsApp webhook secret is not configured.',
        );
      }
      return;
    }
    const expected = `sha256=${createHmac('sha256', secret)
      .update(rawBody || Buffer.alloc(0))
      .digest('hex')}`;
    const received = signature || '';
    const a = Buffer.from(expected);
    const b = Buffer.from(received);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid WhatsApp signature.');
    }
  }

  verifyChallenge(mode?: string, token?: string) {
    const expected = this.config.get<string>('WHATSAPP_VERIFY_TOKEN');
    if (!expected) {
      if (this.config.get('NODE_ENV') === 'production') {
        throw new ServiceUnavailableException(
          'WhatsApp verify token is not configured.',
        );
      }
      throw new UnauthorizedException('WhatsApp webhook is not configured.');
    }
    const a = Buffer.from(expected);
    const b = Buffer.from(token || '');
    if (mode !== 'subscribe' || a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid WhatsApp verification.');
    }
  }
}
