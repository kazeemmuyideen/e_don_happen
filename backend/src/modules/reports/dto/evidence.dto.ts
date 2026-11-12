import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const EVIDENCE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const EVIDENCE_MODERATION_STATES = [
  'pending',
  'approved',
  'rejected',
] as const;

export class UploadEvidenceDto {
  @ApiProperty({ example: 'flood.jpg', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName: string;

  @ApiProperty({ enum: EVIDENCE_MIME_TYPES })
  @IsIn(EVIDENCE_MIME_TYPES)
  mimeType: string;

  @ApiProperty({ description: 'Base64-encoded file contents' })
  @IsString()
  @IsNotEmpty()
  data: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  mediaMetadata?: Record<string, any>;
}

export class ModerateEvidenceDto {
  @ApiProperty({ enum: EVIDENCE_MODERATION_STATES })
  @IsIn(EVIDENCE_MODERATION_STATES)
  moderationState: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
