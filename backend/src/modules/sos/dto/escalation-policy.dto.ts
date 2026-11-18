import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export type EscalationChannel = 'in_app' | 'sms';

export const ESCALATION_CHANNELS: EscalationChannel[] = ['in_app', 'sms'];

export class EscalationPolicyDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 120, example: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  acknowledgeWithinMinutes?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 1440, example: 15 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  escalateAfterMinutes?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 5, example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  maxLevels?: number;

  @ApiPropertyOptional({
    enum: ESCALATION_CHANNELS,
    isArray: true,
    example: ['in_app'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsIn(ESCALATION_CHANNELS, { each: true })
  channels?: EscalationChannel[];
}

export const DEFAULT_ESCALATION_POLICY: Required<EscalationPolicyDto> = {
  acknowledgeWithinMinutes: 10,
  escalateAfterMinutes: 15,
  maxLevels: 2,
  channels: ['in_app'],
};
