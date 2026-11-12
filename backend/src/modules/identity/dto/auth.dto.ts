import {
  IsString,
  IsNotEmpty,
  IsOptional,
  MinLength,
  MaxLength,
  Matches,
  IsArray,
  ArrayMaxSize,
  IsIn,
  IsBoolean,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../interfaces/identity.interface.js';

export class SendOtpDto {
  @ApiProperty({ example: '+2348012345678' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?[1-9]\d{1,14}$/, { message: 'Invalid phone number format' })
  phone: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: '+2348012345678' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?[1-9]\d{1,14}$/, { message: 'Invalid phone number format' })
  phone: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4,6}$/, { message: 'OTP must be 4 to 6 digits' })
  otp: string;
}

export class PrivacySettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  shareLocation?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showPhone?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showDisplayName?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowDirectMessages?: boolean;
}

export class CompleteProfileDto {
  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  displayName: string;

  @ApiProperty({ example: 'en', required: false })
  @IsOptional()
  @IsString()
  language?: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsIn(['Yaba', 'Ikeja', 'Surulere', 'Eti-Osa', 'Lagos Island', 'Ikorodu'], {
    each: true,
  })
  lgas?: string[];
  @ApiProperty({ example: 'John Doe', required: false })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName?: string;

  @ApiProperty({ example: 'en', required: false })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({ type: PrivacySettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrivacySettingsDto)
  privacySettings?: PrivacySettingsDto;
}

export class UserTargetDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId: string;
}

export class AssignResponderDto extends UserTargetDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  communityId: string;
}

export class AssignCommunityAdminDto extends AssignResponderDto {}

export class UserAccountActionDto extends UserTargetDto {
  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class LoginResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  user: {
    id: string;
    phone: string;
    displayName: string;
    role: UserRole;
    accountStatus: string;
    communityId?: string;
  };
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
