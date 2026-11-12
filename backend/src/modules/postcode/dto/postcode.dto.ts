import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PostcodeLookupQueryDto {
  @ApiProperty({ example: 'EK-01-A03-FK-01', description: 'NIPOST postcode' })
  @IsString()
  code: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  level?: number = 1;
}

export class PostcodeAutocompleteQueryDto {
  @ApiProperty({ example: 'EK 01 A' })
  @IsString()
  q: string;
}

export class PostcodeReverseQueryDto {
  @ApiProperty({ minimum: -90, maximum: 90 })
  @Type(() => Number)
  @Min(-90)
  @Max(90)
  lat: number;

  @ApiProperty({ minimum: -180, maximum: 180 })
  @Type(() => Number)
  @Min(-180)
  @Max(180)
  lng: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 250,
    default: 25,
    description: 'Snap radius in metres (max 250)',
  })
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @Max(250)
  maxDistanceM?: number;
}
