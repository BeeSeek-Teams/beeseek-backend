import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Administrator } from '../../entities/administrator.entity';
import { FinanceService } from './finance.service';
import {
  FinanceLoginDto,
  FinanceLoginResponseDto,
  FinanceStatsResponseDto,
  CashflowQueryDto,
  CashflowDataPointDto,
  CreateFundingRequestDto,
  UpdateFundingRequestDto,
  FundingRequestQueryDto,
  FundingRequestResponseDto,
  PaginatedFundingRequestsDto,
} from './dto/finance.dto';

@ApiTags('Finance')
@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  // ─── Authentication ────────────────────────────────────────────────────────

  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Finance portal login',
    description:
      'Authenticate an administrator for the finance portal using password-only auth. ' +
      'Matches the password against all active administrators and returns a JWT token for the matched profile.',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully authenticated',
    type: FinanceLoginResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid password or no matching administrator' })
  async login(@Body() dto: FinanceLoginDto) {
    return this.financeService.login(dto.password);
  }

  // ─── Dashboard Statistics ──────────────────────────────────────────────────

  @Get('stats')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get dashboard statistics',
    description:
      'Returns the four top-level finance boxes: total wallet balance (sum of all user wallets), ' +
      'monthly payouts (sum of successful debits this month), active cash flow (sum of successful credits this month), ' +
      'and estimated burn rate (average monthly debits over last 3 months). Each stat includes a month-over-month trend.',
  })
  @ApiResponse({
    status: 200,
    description: 'Dashboard statistics retrieved',
    type: FinanceStatsResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getStats() {
    return this.financeService.getStats();
  }

  // ─── Analytics / Cashflow Chart ────────────────────────────────────────────

  @Get('analytics/cashflow')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get cashflow analytics chart data',
    description:
      'Returns monthly cashflow vs burn data for the curve chart. ' +
      'Each data point contains the month name, total credits (cashflow), and total debits (burn). ' +
      'Defaults to the last 6 months.',
  })
  @ApiQuery({ name: 'months', required: false, type: Number, description: 'Number of months to retrieve (default: 6)' })
  @ApiResponse({
    status: 200,
    description: 'Cashflow analytics data',
    type: [CashflowDataPointDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getCashflowAnalytics(@Query() query: CashflowQueryDto) {
    return this.financeService.getCashflowAnalytics(query);
  }

  // ─── Funding Requests CRUD ─────────────────────────────────────────────────

  @Get('requests')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List funding requests',
    description:
      'Returns a paginated list of funding requests. Supports filtering by status (Pending, Paid, Rejected), ' +
      'pagination (page + limit), and sort order (asc/desc by creation date).',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 10)' })
  @ApiQuery({ name: 'status', required: false, enum: ['Pending', 'Paid', 'Rejected'], description: 'Filter by status' })
  @ApiQuery({ name: 'sort', required: false, enum: ['asc', 'desc'], description: 'Sort order (default: desc)' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of funding requests',
    type: PaginatedFundingRequestsDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getRequests(@Query() query: FundingRequestQueryDto) {
    return this.financeService.getRequests(query);
  }

  @Post('requests')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a funding request',
    description:
      'Creates a new funding request with Pending status. Supply the amount (in kobo/minor units), ' +
      'description, and date. The creating administrator is tracked.',
  })
  @ApiResponse({
    status: 201,
    description: 'Funding request created',
    type: FundingRequestResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createRequest(
    @Body() dto: CreateFundingRequestDto,
    @CurrentUser() user: Administrator,
  ) {
    return this.financeService.createRequest(dto, user?.id);
  }

  @Patch('requests/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update a funding request',
    description:
      'Partially updates a funding request. Can change amount, description, date, or status (Pending → Paid/Rejected). ' +
      'Only provided fields are updated.',
  })
  @ApiParam({ name: 'id', description: 'Funding request UUID' })
  @ApiResponse({
    status: 200,
    description: 'Funding request updated',
    type: FundingRequestResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Funding request not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async updateRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFundingRequestDto,
  ) {
    return this.financeService.updateRequest(id, dto);
  }

  @Delete('requests/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete a funding request',
    description: 'Permanently deletes a funding record. This action is irreversible.',
  })
  @ApiParam({ name: 'id', description: 'Funding request UUID' })
  @ApiResponse({
    status: 200,
    description: 'Funding request deleted',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Funding request not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async deleteRequest(@Param('id', ParseUUIDPipe) id: string) {
    return this.financeService.deleteRequest(id);
  }
}
