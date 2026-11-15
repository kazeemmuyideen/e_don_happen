import { createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { WhatsAppService } from './whatsapp.service.js';

describe('WhatsAppService', () => {
  it('accepts a valid webhook signature and rejects a bad one', () => {
    const service = new WhatsAppService(
      new ConfigService({ WHATSAPP_APP_SECRET: 'app-secret' }),
    );
    const body = Buffer.from(JSON.stringify({ hello: 'world' }));
    const signature = `sha256=${createHmac('sha256', 'app-secret')
      .update(body)
      .digest('hex')}`;
    expect(() => service.verifySignature(body, signature)).not.toThrow();
    expect(() => service.verifySignature(body, 'sha256=deadbeef')).toThrow();
  });

  it('requires the configured verify token and subscribe mode', () => {
    const service = new WhatsAppService(
      new ConfigService({ WHATSAPP_VERIFY_TOKEN: 'verify-me' }),
    );
    expect(() => service.verifyChallenge('subscribe', 'verify-me')).not.toThrow();
    expect(() => service.verifyChallenge('subscribe', 'wrong')).toThrow();
    expect(() => service.verifyChallenge('other', 'verify-me')).toThrow();
  });

  it('fails closed in production without secrets', () => {
    const service = new WhatsAppService(
      new ConfigService({ NODE_ENV: 'production' }),
    );
    expect(() =>
      service.verifySignature(Buffer.from('{}'), undefined),
    ).toThrow();
    expect(() => service.verifyChallenge('subscribe', 'anything')).toThrow();
  });
});
