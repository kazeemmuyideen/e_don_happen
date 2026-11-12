import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsOptional,
  IsEnum,
  ValidateNested,
  IsNumber,
  Min,
  Max,
  IsArray,
  ArrayMaxSize,
  IsBoolean,
  IsDefined,
  IsISO8601,
  MinLength,
  MaxLength,
  IsIn,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ReportCategory } from '../interfaces/report.interface.js';

export class LocationDto {
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  radius?: number;

  @IsOptional()
  @IsString()
  areaName?: string;

  @ApiPropertyOptional({
    example: 'EK-01-A03-FK-01',
    description:
      'NIPOST alphanumeric postcode (state, LGA, district, area, building). Separators and case are optional.',
  })
  @IsOptional()
  @IsString()
  @Matches(
    /^[A-Za-z]{2}[\s-]?\d{2}[\s-]?[A-Za-z0-9]{3}[\s-]?[A-Za-z]{2}[\s-]?\d{2}$/,
    {
      message:
        'Postcode must be a 5-segment NIPOST code such as EK-01-A03-FK-01',
    },
  )
  postcode?: string;
}

export class CreateReportDto {
  @IsEnum(ReportCategory)
  category: ReportCategory;

  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(1500)
  description: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => LocationDto)
  location: LocationDto;

  @IsOptional()
  @IsISO8601()
  observedAt?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  evidenceReferences?: string[];
}

export class UpdateReportDto {
  @IsOptional()
  @IsEnum(ReportCategory)
  category?: ReportCategory;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(1500)
  description?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  location?: LocationDto;

  @IsOptional()
  @IsISO8601()
  observedAt?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  evidenceReferences?: string[];
}

export class ConfirmationDto {
  @IsUUID()
  reportId: string;

  @IsIn(['confirm', 'dispute'])
  action: 'confirm' | 'dispute';

  @IsOptional()
  @IsBoolean()
  firsthand?: boolean;
}
