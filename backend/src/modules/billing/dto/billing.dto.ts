import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const BILLING_PLANS = ['standard', 'premium', 'enterprise'] as const;
export const BILLING_STATUSES = [
  'active',
  'past_due',
  'cancelled',
  'expired',
] as const;

export class CreateBillingSubscriptionDto {
  @ApiProperty()
  @IsUUID()
  communityId: string;

  @ApiProperty({ enum: BILLING_PLANS })
  @IsIn(BILLING_PLANS)
  plan: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  billingReference?: string;
}

export class UpdateBillingSubscriptionDto {
  @ApiPropertyOptional({ enum: BILLING_PLANS })
  @IsOptional()
  @IsIn(BILLING_PLANS)
  plan?: string;

  @ApiPropertyOptional({ enum: BILLING_STATUSES })
  @IsOptional()
  @IsIn(BILLING_STATUSES)
  status?: string;
}
