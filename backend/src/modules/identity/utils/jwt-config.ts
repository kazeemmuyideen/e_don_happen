import { ConfigService } from '@nestjs/config';

type JwtSecretName = 'JWT_SECRET' | 'JWT_REFRESH_SECRET';

export function getJwtSecret(
  configService: ConfigService,
  name: JwtSecretName,
): string {
  const configured = configService.get<string>(name)?.trim();
  if (configured) return configured;

  const demoMode =
    configService.get('DEMO_MODE') === 'true' &&
    configService.get('NODE_ENV') !== 'production';

  if (demoMode) {
    return `demo-only-${name.toLowerCase()}-not-for-production`;
  }

  throw new Error(
    `${name} must be configured outside demo mode. Refusing to start with a predictable secret.`,
  );
}
