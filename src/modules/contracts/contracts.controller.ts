import { Controller, Post, Body, UseGuards, Get, Param, Query, Res, StreamableFile, Header } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ContractsService } from './contracts.service';
import { PdfService } from '../../common/services/pdf.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../../entities/user.entity';
import { JobStep, JobStatus } from '../../entities/job.entity';
import { AdminGuard } from '../../common/guards/admin.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../entities/administrator.entity';

@Controller('contracts')
@UseGuards(JwtAuthGuard)
export class ContractsController {
  constructor(
    private readonly contractsService: ContractsService,
    private readonly pdfService: PdfService,
  ) {}

  @UseGuards(AdminGuard)
  @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  @Get('admin/jobs')
  async getAdminJobs(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('status') status?: JobStatus,
    @Query('search') search?: string,
  ) {
    return this.contractsService.getAdminJobs({
      page: parseInt(page),
      limit: parseInt(limit),
      status,
      search,
    });
  }

  @UseGuards(AdminGuard)
  @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  @Get('admin/infractions')
  async getAdminInfractions(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
  ) {
    return this.contractsService.getAdminInfractions({
      page: parseInt(page),
      limit: parseInt(limit),
    });
  }

  @Post('request')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createRequest(
    @CurrentUser() user: User,
    @Body()
    body: {
      beeId: string;
      details: string;
      workDate: string;
      startTime: string;
      latitude?: number;
      longitude?: number;
      address?: string;
      roomId: string;
    },
  ) {
    return this.contractsService.createRequest(
      user.id,
      body.beeId,
      body,
      body.roomId,
    );
  }

  @Post(':id/accept')
  async acceptRequest(
    @CurrentUser() user: User,
    @Param('id') contractId: string,
    @Body()
    body: {
      workmanshipCost: number;
      transportFare: number;
      materials?: { item: string; cost: number }[];
      roomId: string;
    },
  ) {
    return this.contractsService.acceptRequest(
      user.id,
      contractId,
      body,
      body.roomId,
    );
  }

  @Post(':id/reject')
  async rejectRequest(
    @CurrentUser() user: User,
    @Param('id') contractId: string,
    @Body() body: { roomId: string },
  ) {
    return this.contractsService.rejectRequest(
      user.id,
      contractId,
      body.roomId,
    );
  }

  @Post(':id/pay')
  async payForContract(
    @CurrentUser() user: User,
    @Param('id') contractId: string,
    @Body() body: { roomId: string; pin: string },
  ) {
    return this.contractsService.payForContract(
      user.id,
      contractId,
      body.roomId,
      body.pin,
    );
  }

  @Post(':id/complete')
  async completeContract(
    @CurrentUser() user: User,
    @Param('id') contractId: string,
    @Body() body: { pin: string },
  ) {
    return this.contractsService.completeContract(
      user.id,
      contractId,
      body.pin,
    );
  }

  @Get(':id')
  async getContract(@CurrentUser() user: User, @Param('id') id: string) {
    return this.contractsService.getContract(id, user);
  }

  /**
   * Generate and stream a PDF for a contract.
   * Server-side generation ensures consistent output across all devices.
   */
  @Get(':id/pdf')
  @Header('Content-Type', 'application/pdf')
  async getContractPdf(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    // Fetch contract with related entities
    const contract = await this.contractsService.getContractForPdf(id, user.id);
    
    // Generate PDF
    const pdfBuffer = await this.pdfService.generateServiceAgreementPdf(contract);
    
    // Set response headers for download
    const filename = `BeeSeek-Agreement-${contract.id.slice(0, 8).toUpperCase()}.pdf`;
    res.set({
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': pdfBuffer.length,
    });
    
    return new StreamableFile(pdfBuffer);
  }

  @Get('agent/:agentId/busy-slots')
  async getBusySlots(
    @Param('agentId') agentId: string,
    @Query('date') date: string,
  ) {
    return this.contractsService.getBusySlots(agentId, date);
  }

  @Get()
  async getMyContracts(
    @CurrentUser() user: User,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    return this.contractsService.getMyContracts(user.id, user.role, parseInt(page), parseInt(limit));
  }

  @Get('mine/jobs')
  async getMyJobs(
    @CurrentUser() user: User,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
  ) {
    return this.contractsService.getMyJobs(user.id, user.role, parseInt(page), parseInt(limit));
  }

  @Get('jobs/:id')
  async getJob(@CurrentUser() user: User, @Param('id') id: string) {
    return this.contractsService.getJob(id, user);
  }

  @Post('jobs/:id/step')
  async updateJobStep(
    @CurrentUser() user: User,
    @Param('id') jobId: string,
    @Body() body: { step: JobStep; arrivalCode?: string },
  ) {
    return this.contractsService.updateJobStep(user.id, jobId, body);
  }

  @Post('jobs/:id/cancel')
  async cancelJob(
    @CurrentUser() user: User,
    @Param('id') jobId: string,
    @Body() body: { reason: string; category?: string },
  ) {
    return this.contractsService.cancelJob(
      user.id,
      jobId,
      body.reason,
      body.category,
    );
  }

  @Post('jobs/:id/status')
  async updateJobStatus(
    @CurrentUser() user: User,
    @Param('id') jobId: string,
    @Body() body: { status: string },
  ) {
    return this.contractsService.updateJobStatus(user, jobId, {
      status: body.status as any,
    });
  }
}
