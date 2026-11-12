import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RolesGuard } from '../identity/guards/roles.guard.js';
import { Roles } from '../identity/decorators/roles.decorator.js';
import { UserRole } from '../identity/interfaces/identity.interface.js';
import { AnalyticsService } from './analytics.service.js';
import {
  AnalyticsQueryDto,
  AuditLogQueryDto,
} from './dto/analytics.dto.js';

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.MODERATOR, UserRole.SUPER_ADMIN)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('reports')
  @ApiOperation({ summary: 'Report volume by state and category' })
  reports(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.reportSummary(query);
  }

  @Get('notifications')
  @ApiOperation({ summary: 'Notification delivery breakdown' })
  notifications(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.notificationSummary(query);
  }

  @Get('incidents')
  @ApiOperation({ summary: 'Incident breakdown by status and verification' })
  incidents() {
    return this.analyticsService.incidentSummary();
  }

  @Get('sos')
  @ApiOperation({ summary: 'SOS request volume and states' })
  sos(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.sosSummary(query);
  }

  @Get('audit-logs')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Paginated audit log (super admin only)' })
  auditLogs(@Query() query: AuditLogQueryDto) {
    return this.analyticsService.auditLogs(query);
  }
}
