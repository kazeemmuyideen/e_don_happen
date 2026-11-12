import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RolesGuard } from '../identity/guards/roles.guard.js';
import { Roles } from '../identity/decorators/roles.decorator.js';
import { CurrentUserId } from '../identity/decorators/current-user-id.decorator.js';
import { UserRole } from '../identity/interfaces/identity.interface.js';
import { IncidentsService } from './incidents.service.js';
import {
  CreateIncidentDto,
  IncidentQueryDto,
  LinkReportsDto,
  UpdateIncidentDto,
  VerifyIncidentDto,
} from './dto/incident.dto.js';

@ApiTags('Incidents')
@ApiBearerAuth()
@Controller('incidents')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(...Object.values(UserRole))
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Post()
  @Roles(UserRole.MODERATOR, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a canonical incident' })
  create(@CurrentUserId() userId: string, @Body() dto: CreateIncidentDto) {
    return this.incidentsService.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List incidents' })
  list(@Query() query: IncidentQueryDto) {
    return this.incidentsService.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an incident with linked reports' })
  get(@Param('id') id: string) {
    return this.incidentsService.get(id);
  }

  @Put(':id')
  @Roles(UserRole.MODERATOR, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update an incident summary, severity or status' })
  update(
    @Param('id') id: string,
    @CurrentUserId() userId: string,
    @Body() dto: UpdateIncidentDto,
  ) {
    return this.incidentsService.update(userId, id, dto);
  }

  @Put(':id/verification')
  @Roles(UserRole.MODERATOR, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Set incident verification state' })
  verify(
    @Param('id') id: string,
    @CurrentUserId() userId: string,
    @Body() dto: VerifyIncidentDto,
  ) {
    return this.incidentsService.verify(userId, id, dto);
  }

  @Post(':id/reports')
  @Roles(UserRole.MODERATOR, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Link reports to an incident' })
  linkReports(
    @Param('id') id: string,
    @CurrentUserId() userId: string,
    @Body() dto: LinkReportsDto,
  ) {
    return this.incidentsService.linkReports(userId, id, dto);
  }

  @Delete(':id/reports/:reportId')
  @Roles(UserRole.MODERATOR, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Unlink a report from an incident' })
  unlinkReport(
    @Param('id') id: string,
    @Param('reportId') reportId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.incidentsService.unlinkReport(userId, id, reportId);
  }
}
