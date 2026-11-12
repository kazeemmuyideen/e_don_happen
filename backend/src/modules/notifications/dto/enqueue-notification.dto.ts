import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeliveryChannel } from './notification-delivery.dto.js';

export class EnqueueNotificationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  incidentIdOrSosId: string;

  @ApiProperty()
  @IsString()
  @IsIn([
    'traffic',
    'weather',
    'fire',
    'security',
    'medical',
    'utilities',
    'community',
    'event',
    'other',
  ])
  category: string;

  @ApiProperty()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiProperty({ enum: ['low', 'normal', 'high', 'critical'] })
  @IsIn(['low', 'normal', 'high', 'critical'])
  priority: 'low' | 'normal' | 'high' | 'critical';

  @ApiProperty()
  @IsString()
  @MinLength(1)
  title: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  body: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  data?: Record<string, any>;

  @ApiPropertyOptional({ enum: DeliveryChannel, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(DeliveryChannel, { each: true })
  channels?: DeliveryChannel[];

  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  cooldownMinutes?: number;
}
