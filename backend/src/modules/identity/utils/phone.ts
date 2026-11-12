import { BadRequestException } from '@nestjs/common';

const E164_PATTERN = /^\+?[1-9]\d{1,14}$/;

export function normalizePhone(phone: string): string {
  const compact = phone.trim().replace(/[\s().-]/g, '');
  const candidate = compact.startsWith('+') ? compact : `+${compact}`;

  if (!E164_PATTERN.test(candidate)) {
    throw new BadRequestException('Invalid phone number format');
  }

  return candidate;
}
