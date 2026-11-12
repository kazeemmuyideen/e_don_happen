import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum SosState {
  ACTIVE = 'active',
  ACKNOWLEDGED = 'acknowledged',
  RESOLVED = 'resolved',
  CANCELLED = 'cancelled',
}

export const OPEN_SOS_STATES = [SosState.ACTIVE, SosState.ACKNOWLEDGED];

export class CreateSosDto {
  @ApiProperty({ example: 'medical' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  incidentType: string;

  @ApiProperty({ minimum: -90, maximum: 90 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({ minimum: -180, maximum: 180 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiPropertyOptional({ description: 'Who may see the live location snapshot' })
  @IsOptional()
  @IsObject()
  sharingPolicy?: Record<string, any>;

  @ApiPropertyOptional({ description: 'How the request escalates' })
  @IsOptional()
  @IsObject()
  escalationPolicy?: Record<string, any>;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

export class UpdateSosStateDto {
  @ApiProperty({ enum: [SosState.RESOLVED, SosState.CANCELLED] })
  @IsIn([SosState.RESOLVED, SosState.CANCELLED])
  state: SosState;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AcknowledgeSosDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
