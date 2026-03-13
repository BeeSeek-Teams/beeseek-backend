import {
  IsEmail,
  IsString,
  MinLength,
  IsInt,
  Min,
  Max,
  IsEnum,
  IsOptional,
  IsUUID,
  Matches,
} from 'class-validator';
import { UserRole } from '../entities/user.entity';
import { AdminRole } from '../entities/administrator.entity';

export class RegisterDto {
  @IsEmail({}, { message: 'Invalid email format' })
  email: string;

  @IsString()
  @MinLength(2, { message: 'First name must be at least 2 characters' })
  firstName: string;

  @IsString()
  @MinLength(2, { message: 'Last name must be at least 2 characters' })
  lastName: string;

  @IsInt({ message: 'Age must be a number' })
  @Min(18, { message: 'Must be at least 18 years old' })
  @Max(120, { message: 'Invalid age' })
  age: number;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @Matches(/[A-Z]/, { message: 'Password must contain at least one uppercase letter' })
  @Matches(/[a-z]/, { message: 'Password must contain at least one lowercase letter' })
  @Matches(/[0-9]/, { message: 'Password must contain at least one number' })
  @Matches(/[^A-Za-z0-9]/, { message: 'Password must contain at least one special character' })
  password: string;

  @IsEnum(UserRole, { message: 'Role must be CLIENT or AGENT' })
  role: UserRole;

  @IsUUID()
  @IsOptional()
  linkedAccountId?: string; // Link to existing CLIENT account when creating AGENT account

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsString()
  deviceType?: string;

  @IsOptional()
  @IsString()
  deviceModel?: string;

  @IsOptional()
  latitude?: number;

  @IsOptional()
  longitude?: number;
}

export class LoginDto {
  @IsEmail({}, { message: 'Invalid email format' })
  email: string;

  @IsString()
  password: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsString()
  deviceType?: string;

  @IsOptional()
  @IsString()
  deviceModel?: string;

  @IsOptional()
  latitude?: number;

  @IsOptional()
  longitude?: number;
}

export class VerifyNINDto {
  @IsString()
  @MinLength(11, { message: 'NIN must be 11 digits' })
  ninNumber: string;

  @IsString()
  @IsOptional()
  bvnNumber?: string;
}

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Invalid email format' })
  email: string;
}

export class VerifyOtpDto {
  @IsEmail({}, { message: 'Invalid email format' })
  email: string;

  @IsString()
  @MinLength(6, { message: 'OTP must be 6 digits' })
  code: string;
}

export class ResetPasswordDto {
  @IsEmail({}, { message: 'Invalid email format' })
  email: string;

  @IsString()
  @MinLength(6, { message: 'OTP must be 6 digits' })
  code: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @Matches(/[A-Z]/, { message: 'Password must contain at least one uppercase letter' })
  @Matches(/[a-z]/, { message: 'Password must contain at least one lowercase letter' })
  @Matches(/[0-9]/, { message: 'Password must contain at least one number' })
  @Matches(/[^A-Za-z0-9]/, { message: 'Password must contain at least one special character' })
  password: string;
}

export class AuthResponseDto {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    slug?: string | null;
    role: UserRole | AdminRole;
    isVerified: boolean;
    isNinVerified?: boolean;
    ninStatus?: string;
    isAvailable?: boolean;
    rating?: number;
    age: number;
    phone?: string;
    bio?: string;
    profileImage?: string;
    walletBalance?: number;
    lockedBalance?: number;
    monnifyNUBAN?: string;
    monnifyBankName?: string;
    monnifyAccountName?: string;
    deviceType?: string;
    emergencyContactName?: string;
    emergencyContactPhone?: string;
    emergencyContactRelationship?: string;
    earlyAccessAchievement?: boolean;
    topRatedAchievement?: boolean;
    goldenBadgeAchievement?: boolean;
    useBiometrics?: boolean;
  };
}

export class JwtPayload {
  sub: string;
  email: string;
  role: UserRole | AdminRole;
  jti?: string;   // JWT ID — unique per token, used for blocklist on logout
  iat?: number;
  exp?: number;
}
