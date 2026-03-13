import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { Bee } from './bee.entity';

export enum UserRole {
  CLIENT = 'CLIENT',
  AGENT = 'AGENT',
  SUPPORT = 'SUPPORT',
  MODERATOR = 'MODERATOR',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

export enum AuthProvider {
  EMAIL = 'EMAIL',
}

export enum NinStatus {
  NOT_SUBMITTED = 'NOT_SUBMITTED',
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  DEACTIVATED = 'DEACTIVATED',
}

@Entity('users')
@Index(['email'])
@Index(['linkedAccountId'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  firstName: string;

  @Column()
  lastName: string;

  @Column({ unique: true })
  email: string;

  @Column({ type: 'varchar', unique: true, nullable: true })
  @Index()
  slug: string | null;

  // Link to the same person's other account (e.g., CLIENT account linked to AGENT account)
  @Column({ type: 'varchar', nullable: true })
  linkedAccountId: string | null;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.CLIENT })
  role: UserRole;

  @Column({ type: 'int' })
  age: number;

  // Authentication fields
  @Column({ type: 'varchar', nullable: true, select: false })
  hashedPassword: string | null;

  @Column({ type: 'enum', enum: AuthProvider, default: AuthProvider.EMAIL })
  authProvider: AuthProvider;

  // Verification fields
  @Column({ default: false })
  isVerified: boolean;

  @Column({ default: false })
  isNinVerified: boolean;

  @Column({
    type: 'enum',
    enum: NinStatus,
    default: NinStatus.NOT_SUBMITTED,
  })
  ninStatus: NinStatus;

  @Column({ type: 'varchar', nullable: true })
  @Index()  // Indexed: used in NIN uniqueness checks on every verification
  ninNumber: string | null;

  @Column({ name: 'nin_verified_at', type: 'timestamp', nullable: true })
  ninVerifiedAt: Date | null;

  @Column({ name: 'nin_registry_name', type: 'varchar', nullable: true })
  ninRegistryName: string | null;

  @Column({ name: 'nin_background_check', type: 'jsonb', nullable: true })
  ninBackgroundCheck: Record<string, any> | null;

  @Column({ name: 'nin_name_match_confidence', type: 'int', nullable: true })
  ninNameMatchConfidence: number | null;

  @Column({ type: 'varchar', nullable: true, select: false })
  resetPasswordOTP: string | null;

  @Column({
    name: 'reset_password_otp_expires',
    type: 'timestamp',
    nullable: true,
    select: false,
  })
  resetPasswordOTPExpires: Date | null;

  @Column({ type: 'varchar', nullable: true, select: false })
  emailVerificationOTP: string | null;

  @Column({
    name: 'email_verification_otp_expires',
    type: 'timestamp',
    nullable: true,
    select: false,
  })
  emailVerificationOTPExpires: Date | null;

  // Security & Transaction PIN
  @Column({
    name: 'hashed_transaction_pin',
    type: 'varchar',
    nullable: true,
    select: false,
  })
  hashedTransactionPin: string | null;

  @Column({ name: 'use_biometrics', default: false })
  useBiometrics: boolean;

  @Column({ name: 'firebase_token', type: 'varchar', nullable: true })
  firebaseToken: string | null;

  @Column({ name: 'push_notifications_enabled', default: true })
  pushNotificationsEnabled: boolean;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;

  @Column({ name: 'deactivated_at', type: 'timestamp', nullable: true })
  deactivatedAt: Date | null;

  @Column({ default: false })
  isDeleted: boolean;

  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt: Date | null;

  // Monnify wallet
  @Column({ type: 'varchar', nullable: true })
  monnifyAccountId: string | null;

  @Column({ type: 'varchar', nullable: true })
  monnifyNUBAN: string | null;

  @Column({ type: 'varchar', nullable: true })
  monnifyBVN: string | null;

  // Wallet balances stored in minor units (Kobo) as bigints for precision and auditability
  @Column({
    type: 'bigint',
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseInt(value),
    },
  })
  walletBalance: number;

  @Column({
    type: 'bigint',
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseInt(value),
    },
  })
  lockedBalance: number;

  // Profile fields
  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', nullable: true })
  profileImage: string | null;

  @Column({ type: 'varchar', nullable: true })
  bio: string | null;

  @Column({ type: 'float', nullable: true, default: 0 })
  rating: number;

  @Column({ type: 'int', default: 0 })
  totalReviews: number;

  @Column({ type: 'float', nullable: true })
  latitude: number | null;

  @Column({ type: 'float', nullable: true })
  longitude: number | null;

  // Achievements
  @Column({ default: false })
  earlyAccessAchievement: boolean;

  @Column({ default: false })
  topRatedAchievement: boolean;

  @Column({ default: false })
  goldenBadgeAchievement: boolean;

  @Column({ name: 'device_id', type: 'varchar', nullable: true })
  @Index()
  deviceId: string | null;

  @Column({ name: 'last_ip_address', type: 'varchar', nullable: true })
  lastIpAddress: string | null;

  @Column({ type: 'varchar', nullable: true })
  deviceType: string | null;

  @Column({ type: 'varchar', nullable: true })
  deviceModel: string | null;

  // Emergency Contact fields
  @Column({ name: 'emergency_contact_name', type: 'varchar', nullable: true })
  emergencyContactName: string | null;

  @Column({ name: 'emergency_contact_phone', type: 'varchar', nullable: true })
  emergencyContactPhone: string | null;

  @Column({
    name: 'emergency_contact_relationship',
    type: 'varchar',
    nullable: true,
  })
  emergencyContactRelationship: string | null;

  // Status fields
  @Column({ default: true })
  isActive: boolean;

  @Column({ default: true })
  isAvailable: boolean;

  @Column({ default: false })
  isBooked: boolean;

  @Column({ type: 'date', nullable: true })
  bookedDate: string | null;

  @Column({ type: 'time', nullable: true })
  bookedTime: string | null;

  @Column({ name: 'last_login_at', type: 'timestamp', nullable: true })
  lastLoginAt: Date | null;

  @Column({ name: 'last_client_login_at', type: 'timestamp', nullable: true })
  lastClientLoginAt: Date | null;

  @Column({ name: 'last_agent_login_at', type: 'timestamp', nullable: true })
  lastAgentLoginAt: Date | null;

  @OneToMany(() => Bee, (bee) => bee.agent)
  bees: Bee[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
