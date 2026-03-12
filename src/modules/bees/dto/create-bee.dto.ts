import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsArray,
} from 'class-validator';

export class CreateBeeDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  category: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsNumber()
  price: number;

  @IsBoolean()
  @IsOptional()
  offersInspection?: boolean;

  @IsNumber()
  @IsOptional()
  inspectionPrice?: number;

  @IsString()
  @IsOptional()
  locationAddress?: string;

  @IsNumber()
  latitude: number;

  @IsNumber()
  longitude: number;

  @IsString()
  @IsOptional()
  workHours?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  images?: string[];

  @IsString()
  @IsOptional()
  clientRequirements?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
