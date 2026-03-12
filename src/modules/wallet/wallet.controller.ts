import { Controller, Get, Post, Delete, Param, Body, UseGuards, Req, Query, Headers, BadRequestException, Header } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../entities/administrator.entity';
import { TransactionType, TransactionStatus } from '../../entities/transaction.entity';

@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get('balance')
  @UseGuards(JwtAuthGuard)
  getBalance(@Req() req) {
    return this.walletService.getBalance(req.user.id);
  }

  @Get('transactions')
  @UseGuards(JwtAuthGuard)
  getTransactions(@Req() req) {
    return this.walletService.getTransactions(req.user.id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN, AdminRole.MODERATOR)
  @Get('admin/transactions')
  getAdminTransactions(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('type') type?: TransactionType,
    @Query('status') status?: TransactionStatus,
    @Query('search') search?: string,
  ) {
    return this.walletService.getAdminTransactions({ page, limit, type, status, search });
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  @Get('admin/stats')
  getAdminStats() {
    return this.walletService.getAdminTransactionStats();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  @Get('admin/economics')
  getEconomicsStats() {
    return this.walletService.getEconomicsStats();
  }

  @Get('banks')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'public, max-age=3600')
  getBanks() {
    return this.walletService.getBanks();
  }

  @Get('user-banks')
  @UseGuards(JwtAuthGuard)
  getUserBanks(@Req() req) {
    return this.walletService.getUserBanks(req.user.id);
  }

  @Post('user-banks')
  @UseGuards(JwtAuthGuard)
  addUserBank(
    @Req() req,
    @Body() body: { bankName: string; bankCode: string; accountNumber: string; accountName: string },
  ) {
    return this.walletService.addUserBank(req.user.id, body);
  }

  @Delete('user-banks/:id')
  @UseGuards(JwtAuthGuard)
  deleteUserBank(@Req() req, @Param('id') id: string) {
    return this.walletService.deleteUserBank(req.user.id, id);
  }

  @Get('validate-account')
  @UseGuards(JwtAuthGuard)
  validateAccount(
    @Query('accountNumber') accountNumber: string,
    @Query('bankCode') bankCode: string,
  ) {
    return this.walletService.validateAccount(accountNumber, bankCode);
  }

  @Post('withdraw')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  withdraw(
    @Req() req,
    @Body() body: { 
      amountKobo: number; 
      bankDetails: { bankName: string; bankCode: string; accountNumber: string; accountName: string }; 
      pin: string;
      idempotencyKey?: string;
    },
  ) {
    return this.walletService.withdraw(
      req.user.id,
      body.amountKobo,
      body.bankDetails,
      body.pin,
      body.idempotencyKey,
    );
  }

  @Post('webhook/monnify')
  async monnifyWebhook(
    @Body() body: any,
    @Headers('monnify-signature') signature: string,
  ) {
    return this.walletService.handleMonnifyWebhook(body, signature);
  }
}
