import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsDateString,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { FundingRequestStatus } from '../../../entities/funding-request.entity';

// ─── Auth ────────────────────────────────────────────────────────────────────

export class FinanceLoginDto {
  @ApiProperty({
    description: 'Administrator password',
    example: 'YourSecureP@ss1',
  })
  @IsString()
  @MinLength(1, { message: 'Password is required' })
  password: string;
}

export class FinanceLoginResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIs...' })
  token: string;

  @ApiProperty({
    example: {
      id: 'uuid',
      firstName: 'John',
      lastName: 'Doe',
      email: 'admin@beeseek.site',
      role: 'ADMIN',
    },
  })
  admin: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
  };
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export class FinanceStatItemDto {
  @ApiProperty({ example: 45200000 })
  amount: number;

  @ApiProperty({ example: '+12.5%' })
  trend: string;
}

export class FinanceStatsResponseDto {
  @ApiProperty({ type: FinanceStatItemDto })
  totalWalletBalance: FinanceStatItemDto;

  @ApiProperty({ type: FinanceStatItemDto })
  monthlyPayouts: FinanceStatItemDto;

  @ApiProperty({ type: FinanceStatItemDto })
  activeCashFlow: FinanceStatItemDto;

  @ApiProperty({ type: FinanceStatItemDto })
  estimatedBurnRate: FinanceStatItemDto;
}

// ─── Analytics / Cashflow ────────────────────────────────────────────────────

export class CashflowQueryDto {
  @ApiPropertyOptional({ description: 'Number of months to retrieve', example: 6, default: 6 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  months?: number = 6;
}

export class CashflowDataPointDto {
  @ApiProperty({ example: 'Jan' })
  name: string;

  @ApiProperty({ example: 4000000 })
  cashflow: number;

  @ApiProperty({ example: 2400000 })
  burn: number;
}

// ─── Funding Requests ────────────────────────────────────────────────────────

export class CreateFundingRequestDto {
  @ApiProperty({ description: 'Amount in kobo/minor units', example: 500000 })
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiProperty({ description: 'Date of the request (YYYY-MM-DD)', example: '2024-03-15' })
  @IsDateString()
  date: string;

  @ApiProperty({ description: 'Description of the funding request', example: 'Marketing Ad Spend' })
  @IsString()
  @MinLength(1, { message: 'Description is required' })
  description: string;
}

export class UpdateFundingRequestDto {
  @ApiPropertyOptional({ description: 'Updated amount', example: 600000 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  amount?: number;

  @ApiPropertyOptional({ description: 'Updated date', example: '2024-03-16' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ description: 'Updated description', example: 'Updated office supplies' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Updated status',
    enum: FundingRequestStatus,
    example: FundingRequestStatus.PAID,
  })
  @IsOptional()
  @IsEnum(FundingRequestStatus)
  status?: FundingRequestStatus;
}

export class FundingRequestQueryDto {
  @ApiPropertyOptional({ description: 'Page number', example: 1, default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', example: 10, default: 10 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  limit?: number = 10;

  @ApiPropertyOptional({
    description: 'Filter by status',
    enum: FundingRequestStatus,
    example: 'Pending',
  })
  @IsOptional()
  @IsEnum(FundingRequestStatus)
  status?: FundingRequestStatus;

  @ApiPropertyOptional({ description: 'Sort order', enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsString()
  sort?: 'asc' | 'desc' = 'desc';
}

export class FundingRequestResponseDto {
  @ApiProperty({ example: 'req_12345' })
  id: string;

  @ApiProperty({ example: 1250000 })
  amount: number;

  @ApiProperty({ example: '2024-03-10' })
  date: string;

  @ApiProperty({ example: 'Office Supplies' })
  description: string;

  @ApiProperty({ enum: FundingRequestStatus, example: 'Pending' })
  status: FundingRequestStatus;
}

export class PaginationMetaDto {
  @ApiProperty({ example: 45 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 5 })
  lastPage: number;
}

export class PaginatedFundingRequestsDto {
  @ApiProperty({ type: [FundingRequestResponseDto] })
  items: FundingRequestResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
