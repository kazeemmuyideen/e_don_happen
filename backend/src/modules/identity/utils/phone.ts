import { BadRequestException } from '@nestjs/common';

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const NIGERIAN_LOCAL_PATTERN = /^0\d{10}$/;

export function normalizePhone(phone: string): string {
  const compact = phone.trim().replace(/[\s().-]/g, '');

  let candidate: string;
  if (compact.startsWith('+')) {
    candidate = compact;
  } else if (NIGERIAN_LOCAL_PATTERN.test(compact)) {
    candidate = `+234${compact.slice(1)}`;
  } else {
    candidate = `+${compact}`;
  }

  if (!E164_PATTERN.test(candidate)) {
    throw new BadRequestException('Invalid phone number format');
  }

  return candidate;
}
