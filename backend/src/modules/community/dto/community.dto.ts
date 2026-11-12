import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GeoJsonPolygonDto {
  @ApiProperty({ example: 'Polygon' })
  @IsIn(['Polygon'])
  type: 'Polygon';

  @ApiProperty({
    description: 'Array of linear rings, each an array of [lng, lat] pairs',
    example: [
      [
        [3.35, 6.5],
        [3.36, 6.5],
        [3.36, 6.51],
        [3.35, 6.51],
        [3.35, 6.5],
      ],
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  coordinates: number[][][];
}

export class CreateCommunityDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ type: GeoJsonPolygonDto })
  @ValidateNested()
  @Type(() => GeoJsonPolygonDto)
  boundary: GeoJsonPolygonDto;

  @ApiPropertyOptional({ example: 'standard' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  plan?: string;
}

export class UpdateCommunityDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ enum: ['active', 'suspended', 'archived'] })
  @IsOptional()
  @IsIn(['active', 'suspended', 'archived'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  plan?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  responderCoverageConfiguration?: Record<string, any>;
}

export class AddResponderDto {
  @ApiProperty()
  @IsUUID()
  userId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  qualificationsOrRoleClaims?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  availabilityWindow?: Record<string, any>;

  @ApiPropertyOptional({ type: GeoJsonPolygonDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => GeoJsonPolygonDto)
  coverageArea?: GeoJsonPolygonDto;
}

export class UpdateResponderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  qualificationsOrRoleClaims?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  availabilityWindow?: Record<string, any>;

  @ApiPropertyOptional({ type: GeoJsonPolygonDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => GeoJsonPolygonDto)
  coverageArea?: GeoJsonPolygonDto;

  @ApiPropertyOptional({ enum: ['active', 'inactive', 'suspended'] })
  @IsOptional()
  @IsIn(['active', 'inactive', 'suspended'])
  status?: string;
}

export class AssignCommunityAdminDto {
  @ApiProperty()
  @IsUUID()
  userId: string;
}
