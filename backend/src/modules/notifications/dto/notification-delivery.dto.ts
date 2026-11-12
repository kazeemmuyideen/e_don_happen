import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum DeliveryChannel {
  PUSH = 'push',
  SMS = 'sms',
  EMAIL = 'email',
  VOICE = 'voice',
  USSD = 'ussd',
}

export enum DeliveryState {
  QUEUED = 'queued',
  SENT = 'sent',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  ACKNOWLEDGED = 'acknowledged',
}

export class CreateNotificationDeliveryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  incidentIdOrSosId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  recipientId: string;

  @ApiProperty({ enum: DeliveryChannel })
  @IsEnum(DeliveryChannel)
  channel: DeliveryChannel;

  @ApiProperty({ example: 'fcm', description: 'Provider name (e.g., fcm, twilio, africas_talking)' })
  @IsString()
  provider: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsNumber()
  attempt?: number;

  @ApiPropertyOptional({ enum: DeliveryState, default: DeliveryState.QUEUED })
  @IsOptional()
  @IsEnum(DeliveryState)
  deliveryState?: DeliveryState;
}

export class UpdateNotificationDeliveryDto {
  @ApiPropertyOptional({ enum: DeliveryState })
  @IsOptional()
  @IsEnum(DeliveryState)
  deliveryState?: DeliveryState;

  @ApiPropertyOptional({ description: 'Provider-specific timestamps (sent_at, delivered_at, etc.)' })
  @IsOptional()
  timestamps?: Record<string, Date>;

  @ApiPropertyOptional({ description: 'Cost metadata from provider' })
  @IsOptional()
  costMetadata?: Record<string, any>;
}

export class NotificationDeliveryFilterDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  incidentIdOrSosId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  recipientId?: string;

  @ApiPropertyOptional({ enum: DeliveryChannel })
  @IsOptional()
  @IsEnum(DeliveryChannel)
  channel?: DeliveryChannel;

  @ApiPropertyOptional({ enum: DeliveryState })
  @IsOptional()
  @IsEnum(DeliveryState)
  deliveryState?: DeliveryState;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ProviderResponseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  providerResponse?: Record<string, any>;
}

export class MarkDeliveryFailedDto {
  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  error: string;

  @ApiProperty()
  @IsBoolean()
  willRetry: boolean;
}