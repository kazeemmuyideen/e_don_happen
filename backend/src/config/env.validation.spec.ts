import { describe, expect, it } from 'vitest';
import {
  parseProxyTrust,
  validateProductionEnvironment,
} from './env.validation.js';

const productionEnvironment = () => ({
  NODE_ENV: 'production',
  DEMO_MODE: 'false',
  JWT_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
  WHATSAPP_OTP_SECRET: 'c'.repeat(48),
  DB_USERNAME: 'signal',
  DB_PASSWORD: 'a-strong-database-password',
  BIND_HOST: '127.0.0.1',
  CORS_ORIGIN: 'https://app.example.com',
  TRUST_PROXY: '1',
  OTP_DELIVERY_DRIVER: 'whatsapp',
  WHATSAPP_ACCESS_TOKEN: 'token',
  WHATSAPP_PHONE_NUMBER_ID: 'phone-id',
  WHATSAPP_APP_SECRET: 'app-secret',
  WHATSAPP_VERIFY_TOKEN: 'verify-token',
  EVIDENCE_SCANNER_DRIVER: 'clamav',
  EVIDENCE_SCANNER_HOST: '127.0.0.1',
  PAYMENT_PROVIDER: 'paystack',
  PAYMENT_SECRET_KEY: 'payment-secret',
  PAYMENT_PUBLIC_KEY: 'payment-public',
  PAYMENT_WEBHOOK_SECRET: 'payment-webhook',
  PAYMENT_CALLBACK_URL: 'https://app.example.com/payments/callback',
  DISPATCH_DRIVER: 'off',
});

describe('production environment validation', () => {
  it('does not validate development environments', () => {
    expect(() =>
      validateProductionEnvironment({
        NODE_ENV: 'development',
        JWT_SECRET: 'demo',
      }),
    ).not.toThrow();
  });

  it('rejects demo placeholders and insecure origins', () => {
    expect(() =>
      validateProductionEnvironment({
        ...productionEnvironment(),
        JWT_SECRET: 'local-demo-access-secret-change-before-deployment',
        CORS_ORIGIN: 'http://127.0.0.1:5173',
      }),
    ).toThrow(/JWT_SECRET.*CORS_ORIGIN/s);
  });

  it('accepts a fully configured production environment', () => {
    expect(() =>
      validateProductionEnvironment(productionEnvironment()),
    ).not.toThrow();
  });

  it('requires an integer trust proxy hop count and explicit bind host', () => {
    expect(() =>
      validateProductionEnvironment({
        ...productionEnvironment(),
        TRUST_PROXY: 'true',
      }),
    ).toThrow(/TRUST_PROXY/);
    expect(() =>
      validateProductionEnvironment({
        ...productionEnvironment(),
        TRUST_PROXY: 'false',
      }),
    ).toThrow(/TRUST_PROXY/);
    expect(() =>
      validateProductionEnvironment({
        ...productionEnvironment(),
        BIND_HOST: '',
      }),
    ).toThrow(/BIND_HOST/);
  });

  it('requires provider credentials when a real driver is selected', () => {
    expect(() =>
      validateProductionEnvironment({
        ...productionEnvironment(),
        OTP_DELIVERY_DRIVER: 'sms',
        SMS_API_URL: '',
        EVIDENCE_DRIVER: 's3',
        S3_BUCKET: '',
        PAYMENT_SECRET_KEY: '',
        DISPATCH_DRIVER: 'sms',
        DISPATCH_API_URL: '',
      }),
    ).toThrow(/SMS_API_URL.*S3_BUCKET.*PAYMENT_SECRET_KEY.*DISPATCH_API_URL/s);
  });

  it('rejects demo payment and scan drivers in production', () => {
    expect(() =>
      validateProductionEnvironment({
        ...productionEnvironment(),
        EVIDENCE_SCANNER_DRIVER: 'passthrough',
        PAYMENT_PROVIDER: 'demo',
      }),
    ).toThrow(/EVIDENCE_SCANNER_DRIVER.*PAYMENT_PROVIDER/s);
  });
});

describe('parseProxyTrust', () => {
  it('maps disabled and boolean settings', () => {
    expect(parseProxyTrust(undefined)).toBe(false);
    expect(parseProxyTrust('false')).toBe(false);
    expect(parseProxyTrust('true')).toBe(1);
  });

  it('maps positive integer hop counts and rejects invalid values', () => {
    expect(parseProxyTrust('2')).toBe(2);
    expect(parseProxyTrust('many')).toBe(false);
  });
});
