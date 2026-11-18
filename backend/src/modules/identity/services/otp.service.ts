import {
  HttpException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../redis/redis.module.js';
import {
  MemoryOtpStore,
  RedisOtpStore,
  type OtpRecord,
  type OtpStore,
} from './otp.store.js';
import { WhatsAppService } from './whatsapp.service.js';
import { SmsOtpService } from './sms-otp.service.js';

@Injectable()
export class OtpService {
  private readonly store: OtpStore;
  private readonly demoMailbox = new Map<
    string,
    { code: string; expiresAt: number; attempts: number }
  >();
  private mailboxWrite: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: ConfigService,
    private readonly whatsapp: WhatsAppService,
    @Optional() private readonly sms?: SmsOtpService,
    @Optional() @Inject(REDIS_CLIENT) redis?: Redis,
  ) {
    this.store = redis ? new RedisOtpStore(redis) : new MemoryOtpStore();
  }

  private get demoMode() {
    return (
      this.config.get('DEMO_MODE') === 'true' &&
      this.config.get('NODE_ENV') !== 'production'
    );
  }

  private get driver() {
    return (
      this.config.get<string>('sms.driver') ||
      this.config.get<string>('WHATSAPP_DRIVER') ||
      (this.demoMode ? 'console' : 'whatsapp')
    );
  }

  private get ttlMs() {
    return (
      parseInt(this.config.get<string>('WHATSAPP_OTP_TTL_SECONDS') || '300', 10) *
      1000
    );
  }

  private get maxAttempts() {
    return parseInt(
      this.config.get<string>('WHATSAPP_OTP_MAX_ATTEMPTS') || '3',
      10,
    );
  }

  private get rateWindowMs() {
    return (
      parseInt(
        this.config.get<string>('WHATSAPP_OTP_RATE_WINDOW_SECONDS') || '900',
        10,
      ) * 1000
    );
  }

  private get rateLimit() {
    return parseInt(
      this.config.get<string>('WHATSAPP_OTP_RATE_LIMIT') || '3',
      10,
    );
  }

  private hash(phone: string, code: string) {
    const secret =
      this.config.get<string>('WHATSAPP_OTP_SECRET') ||
      (this.demoMode ? 'demo-otp-secret' : '');
    if (!secret) {
      throw new ServiceUnavailableException(
        'WhatsApp OTP secret is not configured.',
      );
    }
    return createHmac('sha256', secret)
      .update(`${phone}:${code}`)
      .digest('hex');
  }

  async sendOtp(phone: string) {
    if (this.driver === 'console' && !this.demoMode) {
      throw new ServiceUnavailableException(
        'Console OTP delivery is only available in local demo mode.',
      );
    }
    if (this.driver === 'whatsapp' && !this.whatsapp.isConfigured()) {
      throw new ServiceUnavailableException(
        'WhatsApp provider is not configured.',
      );
    }
    if (this.driver === 'sms' && !this.sms?.isConfigured()) {
      throw new ServiceUnavailableException('SMS provider is not configured.');
    }

    const recent = await this.store.incrementRate(phone, this.rateWindowMs);
    if (recent > this.rateLimit) {
      throw new HttpException(
        'Too many OTP requests. Try again in 15 minutes.',
        429,
      );
    }

    const code = String(randomInt(100000, 1000000));
    const expiresAt = Date.now() + this.ttlMs;
    const record: OtpRecord = {
      codeHash: this.hash(phone, code),
      expiresAt,
      attempts: 0,
    };
    await this.store.save(phone, record, this.ttlMs);

    if (this.driver === 'console') {
      this.cleanupMailbox();
      this.demoMailbox.set(phone, {
        code,
        expiresAt,
        attempts: 0,
      });
      await this.persistMailbox();
      return {
        success: true,
        message: 'Verification requested. Contact the demo host for your code.',
      };
    }

    if (this.driver === 'sms') {
      await this.sms!.sendOtpCode(phone, code);
      return {
        success: true,
        message: 'If this number can receive SMS, a verification code was sent.',
      };
    }

    await this.whatsapp.sendOtpCode(phone, code);
    return {
      success: true,
      message:
        'If this number can receive WhatsApp messages, a verification code was sent.',
    };
  }

  private cleanupMailbox() {
    const now = Date.now();
    for (const [phone, item] of this.demoMailbox)
      if (item.expiresAt <= now || item.attempts >= this.maxAttempts)
        this.demoMailbox.delete(phone);
  }

  private persistMailbox() {
    const path = resolve(
      this.config.get<string>('DEMO_OTP_FILE') || '.local/demo-otps.json',
    );
    this.mailboxWrite = this.mailboxWrite
      .catch(() => {})
      .then(async () => {
        const codes = [...this.demoMailbox]
          .filter(
            ([, item]) =>
              item.expiresAt > Date.now() && item.attempts < this.maxAttempts,
          )
          .map(([phone, item]) => ({
            phone,
            code: item.code,
            expiresAt: new Date(item.expiresAt).toISOString(),
          }));
        await mkdir(dirname(path), { recursive: true });
        await writeFile(
          path + '.tmp',
          JSON.stringify(
            { updatedAt: new Date().toISOString(), codes },
            null,
            2,
          ) + '\n',
          { mode: 0o600 },
        );
        await rename(path + '.tmp', path);
      });
    return this.mailboxWrite;
  }

  async verifyOtp(phone: string, code: string) {
    const record = await this.store.get(phone);
    if (!record || record.expiresAt <= Date.now()) {
      await this.store.delete(phone);
      return { success: false, message: 'Request a fresh code.' };
    }
    if (record.attempts >= this.maxAttempts) {
      await this.store.delete(phone);
      this.demoMailbox.delete(phone);
      if (this.driver === 'console') await this.persistMailbox();
      return {
        success: false,
        message: 'Too many attempts. Request a fresh code.',
      };
    }

    const expected = Buffer.from(this.hash(phone, code));
    const actual = Buffer.from(record.codeHash);
    const matches =
      expected.length === actual.length && timingSafeEqual(expected, actual);

    if (!matches) {
      record.attempts += 1;
      if (record.attempts >= this.maxAttempts) {
        await this.store.delete(phone);
        this.demoMailbox.delete(phone);
      } else {
        await this.store.save(phone, record, record.expiresAt - Date.now());
        const demo = this.demoMailbox.get(phone);
        if (demo) demo.attempts = record.attempts;
      }
      if (this.driver === 'console') await this.persistMailbox();
      return { success: false, message: 'Invalid code.' };
    }

    await this.store.delete(phone);
    this.demoMailbox.delete(phone);
    if (this.driver === 'console') await this.persistMailbox();
    return { success: true, message: 'Phone verified.' };
  }
}
