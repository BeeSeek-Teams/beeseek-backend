import { IsString, IsOptional, IsBoolean, IsNumber, IsPhoneNumber, MaxLength } from 'class-validator';

/**
 * DTO for user profile updates. Only whitelisted fields can be updated.
 * Prevents mass assignment of sensitive fields like role, walletBalance, isVerified, etc.
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @IsOptional()
  @IsString()
  profileImage?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @IsOptional()
  @IsBoolean()
  pushNotificationsEnabled?: boolean;

  // Emergency contact fields
  @IsOptional()
  @IsString()
  @MaxLength(100)
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  emergencyContactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  emergencyContactRelationship?: string;

  // Device info (updated on login, but also allowed from profile)
  @IsOptional()
  @IsString()
  deviceType?: string;

  @IsOptional()
  @IsString()
  deviceModel?: string;
}
