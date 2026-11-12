import { BadRequestException } from '@nestjs/common';

/**
 * Nigeria's National Digital Alphanumeric Postcode System (NDAPS).
 * Five segments: state (2 letters), LGA (2 digits), district (3
 * alphanumeric), area (2 letters), building unit (2 digits).
 * Example: EK-01-A03-FK-01. Separators (spaces/hyphens) and case are
 * insignificant.
 */
export const POSTCODE_COMPACT_PATTERN =
  /^[A-Z]{2}(0[1-9]|[1-9][0-9])[A-Z0-9]{3}[A-Z]{2}(0[1-9]|[1-9][0-9])$/;

export function normalizePostcode(postcode: string): string {
  const compact = postcode.trim().replace(/[\s-]/g, '').toUpperCase();

  if (!POSTCODE_COMPACT_PATTERN.test(compact)) {
    throw new BadRequestException(
      'Invalid postcode format. Expected a 5-segment NIPOST code such as EK-01-A03-FK-01',
    );
  }

  return compact;
}

export function formatPostcodeDisplay(compact: string): string {
  return [
    compact.slice(0, 2),
    compact.slice(2, 4),
    compact.slice(4, 7),
    compact.slice(7, 9),
    compact.slice(9, 11),
  ].join(' ');
}
