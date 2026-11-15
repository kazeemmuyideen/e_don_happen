import type { Redis } from 'ioredis';

export interface OtpRecord {
  codeHash: string;
  expiresAt: number;
  attempts: number;
}

export interface OtpStore {
  incrementRate(phone: string, windowMs: number): Promise<number>;
  save(phone: string, record: OtpRecord, ttlMs: number): Promise<void>;
  get(phone: string): Promise<OtpRecord | null>;
  delete(phone: string): Promise<void>;
}

const codeKey = (phone: string) => `otp:code:${phone}`;
const rateKey = (phone: string) => `otp:rate:${phone}`;

export class RedisOtpStore implements OtpStore {
  constructor(private readonly redis: Redis) {}

  async incrementRate(phone: string, windowMs: number): Promise<number> {
    const key = rateKey(phone);
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.pexpire(key, windowMs);
    return count;
  }

  async save(phone: string, record: OtpRecord, ttlMs: number): Promise<void> {
    await this.redis.set(codeKey(phone), JSON.stringify(record), 'PX', ttlMs);
  }

  async get(phone: string): Promise<OtpRecord | null> {
    const raw = await this.redis.get(codeKey(phone));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as OtpRecord;
    } catch {
      await this.delete(phone);
      return null;
    }
  }

  async delete(phone: string): Promise<void> {
    await this.redis.del(codeKey(phone));
  }
}

export class MemoryOtpStore implements OtpStore {
  private readonly codes = new Map<
    string,
    { record: OtpRecord; expiresAt: number }
  >();
  private readonly rates = new Map<string, { count: number; resetAt: number }>();

  async incrementRate(phone: string, windowMs: number): Promise<number> {
    const now = Date.now();
    const current = this.rates.get(phone);
    if (!current || current.resetAt <= now) {
      this.rates.set(phone, { count: 1, resetAt: now + windowMs });
      return 1;
    }
    current.count += 1;
    return current.count;
  }

  async save(phone: string, record: OtpRecord, ttlMs: number): Promise<void> {
    this.codes.set(phone, { record, expiresAt: Date.now() + ttlMs });
  }

  async get(phone: string): Promise<OtpRecord | null> {
    const stored = this.codes.get(phone);
    if (!stored) return null;
    if (stored.expiresAt <= Date.now()) {
      this.codes.delete(phone);
      return null;
    }
    return stored.record;
  }

  async delete(phone: string): Promise<void> {
    this.codes.delete(phone);
  }
}
