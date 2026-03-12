import { IsEnum, IsNotEmpty, IsOptional, IsString, IsObject } from 'class-validator';
import { NotificationType } from '../../../entities/notification.entity';

export class CreateNotificationDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsNotEmpty()
  @IsString()
  message: string;

  @IsNotEmpty()
  @IsEnum(NotificationType)
  type: NotificationType;

  @IsNotEmpty()
  @IsString()
  userId: string;

  @IsOptional()
  @IsObject()
  metadata?: any;
}

export class SendPushNotificationDto {
  @IsNotEmpty()
  @IsString()
  userId: string;

  @IsNotEmpty()
  @IsString()
  title: string;

  @IsNotEmpty()
  @IsString()
  body: string;

  @IsOptional()
  @IsObject()
  data?: any;
}
