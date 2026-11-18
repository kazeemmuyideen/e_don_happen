const PLACEHOLDER_VALUES = new Set([
  'local-demo-access-secret-change-before-deployment',
  'local-demo-refresh-secret-change-before-deployment',
  'demo-otp-secret-change-me',
  'change-me',
  'changeme',
  'postgres',
  'mailto:demo@example.com',
]);

type Environment = Record<string, string | undefined>;

function value(env: Environment, name: string) {
  return env[name]?.trim() ?? '';
}

function isPlaceholder(value: string) {
  return PLACEHOLDER_VALUES.has(value.toLowerCase());
}

function requireValue(
  env: Environment,
  name: string,
  errors: string[],
  options: { minLength?: number; allowPlaceholder?: boolean } = {},
) {
  const candidate = value(env, name);
  if (!candidate) {
    errors.push(`${name} is required`);
    return '';
  }
  if (!options.allowPlaceholder && isPlaceholder(candidate)) {
    errors.push(`${name} must not be a demo placeholder`);
    return '';
  }
  if (options.minLength && candidate.length < options.minLength) {
    errors.push(`${name} must be at least ${options.minLength} characters`);
    return '';
  }
  return candidate;
}

export function parseProxyTrust(
  configured?: string,
): boolean | number {
  if (!configured || configured === 'false') return false;
  if (configured === 'true') return 1;
  const hops = Number(configured);
  return Number.isInteger(hops) && hops > 0 ? hops : false;
}

export function validateProductionEnvironment(
  env: Environment = process.env,
): void {
  if (value(env, 'NODE_ENV') !== 'production') return;

  const errors: string[] = [];
  if (value(env, 'DEMO_MODE') === 'true') {
    errors.push('DEMO_MODE must not be enabled in production');
  }

  const accessSecret = requireValue(env, 'JWT_SECRET', errors, {
    minLength: 32,
  });
  const refreshSecret = requireValue(env, 'JWT_REFRESH_SECRET', errors, {
    minLength: 32,
  });
  requireValue(env, 'WHATSAPP_OTP_SECRET', errors, { minLength: 32 });
  if (accessSecret && accessSecret === refreshSecret) {
    errors.push('JWT_SECRET and JWT_REFRESH_SECRET must be different');
  }

  requireValue(env, 'DB_USERNAME', errors);
  requireValue(env, 'DB_PASSWORD', errors, { minLength: 12 });

  const corsOrigin = value(env, 'CORS_ORIGIN');
  if (!corsOrigin || corsOrigin === '*' || !corsOrigin.startsWith('https://')) {
    errors.push('CORS_ORIGIN must be a specific HTTPS origin');
  }

  const proxyTrust = parseProxyTrust(value(env, 'TRUST_PROXY'));
  if (typeof proxyTrust !== 'number') {
    errors.push('TRUST_PROXY must be a positive trusted-hop count');
  }

  const otpDriver =
    value(env, 'OTP_DELIVERY_DRIVER') ||
    value(env, 'WHATSAPP_DRIVER') ||
    'whatsapp';
  if (otpDriver === 'console') {
    errors.push('OTP_DELIVERY_DRIVER cannot be console in production');
  } else if (otpDriver === 'whatsapp') {
    requireValue(env, 'WHATSAPP_ACCESS_TOKEN', errors);
    requireValue(env, 'WHATSAPP_PHONE_NUMBER_ID', errors);
    requireValue(env, 'WHATSAPP_APP_SECRET', errors);
    requireValue(env, 'WHATSAPP_VERIFY_TOKEN', errors);
  } else if (otpDriver === 'sms') {
    requireValue(env, 'SMS_API_URL', errors);
    requireValue(env, 'SMS_API_KEY', errors);
    requireValue(env, 'SMS_SENDER_ID', errors);
  } else {
    errors.push('OTP_DELIVERY_DRIVER must be whatsapp or sms');
  }

  const evidenceDriver = value(env, 'EVIDENCE_DRIVER') || 'local';
  if (evidenceDriver === 's3') {
    requireValue(env, 'S3_BUCKET', errors);
    requireValue(env, 'S3_REGION', errors);
  } else if (evidenceDriver !== 'local') {
    errors.push('EVIDENCE_DRIVER must be local or s3');
  }
  const scanDriver = value(env, 'EVIDENCE_SCANNER_DRIVER') || 'clamav';
  if (scanDriver !== 'clamav') {
    errors.push('EVIDENCE_SCANNER_DRIVER must be clamav in production');
  }
  requireValue(env, 'EVIDENCE_SCANNER_HOST', errors);

  const paymentProvider = value(env, 'PAYMENT_PROVIDER') || 'paystack';
  if (paymentProvider !== 'paystack') {
    errors.push('PAYMENT_PROVIDER must be paystack in production');
  }
  requireValue(env, 'PAYMENT_SECRET_KEY', errors);
  requireValue(env, 'PAYMENT_PUBLIC_KEY', errors);
  requireValue(env, 'PAYMENT_WEBHOOK_SECRET', errors);
  const paymentCallback = value(env, 'PAYMENT_CALLBACK_URL');
  if (!paymentCallback || !paymentCallback.startsWith('https://')) {
    errors.push('PAYMENT_CALLBACK_URL must be a specific HTTPS URL');
  }

  const dispatchDriver = value(env, 'DISPATCH_DRIVER') || 'off';
  if (dispatchDriver === 'sms') {
    requireValue(env, 'DISPATCH_API_URL', errors);
    requireValue(env, 'DISPATCH_API_KEY', errors);
    requireValue(env, 'DISPATCH_SENDER_ID', errors);
  } else if (dispatchDriver !== 'off') {
    errors.push('DISPATCH_DRIVER must be off or sms');
  }

  if (errors.length) {
    throw new Error(
      `Invalid production configuration:\n- ${errors.join('\n- ')}`,
    );
  }
}
