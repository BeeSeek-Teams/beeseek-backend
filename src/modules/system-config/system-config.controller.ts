import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { SystemConfigService } from './system-config.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '../../entities/administrator.entity';

@Controller('system-config')
export class SystemConfigController {
  constructor(private readonly configService: SystemConfigService) {}

  @Get('versions')
  async getVersions() {
    const config = await this.configService.getConfig();
    
    if (!config) {
      return {
        client: { latest: '1.0.0', min: '1.0.0', iosUrl: '', androidUrl: '' },
        agent: { latest: '1.0.0', min: '1.0.0', iosUrl: '', androidUrl: '' },
        message: '',
        maintenance: false,
      };
    }

    return {
      client: {
        latest: config.clientVersion,
        min: config.clientMinVersion,
        iosUrl: config.clientIosUrl,
        androidUrl: config.clientAndroidUrl,
      },
      agent: {
        latest: config.agentVersion,
        min: config.agentMinVersion,
        iosUrl: config.agentIosUrl,
        androidUrl: config.agentAndroidUrl,
      },
      message: config.updateMessage,
      maintenance: config.maintenanceMode === 'true' || config.maintenanceMode === '1',
    };
  }

  @Post('admin/update')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminRole.ADMIN, AdminRole.SUPER_ADMIN)
  async updateConfig(@Body() data: any) {
    return this.configService.updateConfig(data);
  }
}
