import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RolesGuard } from '../identity/guards/roles.guard.js';
import { Roles } from '../identity/decorators/roles.decorator.js';
import { CurrentUserId } from '../identity/decorators/current-user-id.decorator.js';
import { UserRole } from '../identity/interfaces/identity.interface.js';
import { SosService } from './sos.service.js';
import {
  AcknowledgeSosDto,
  CreateSosDto,
  UpdateSosStateDto,
} from './dto/sos.dto.js';

@ApiTags('SOS')
@ApiBearerAuth()
@Controller('sos')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(...Object.values(UserRole))
export class SosController {
  constructor(private readonly sosService: SosService) {}

  @Post()
  @ApiOperation({ summary: 'Raise an SOS and fan out to nearby responders' })
  @ApiResponse({ status: 201 })
  create(@CurrentUserId() userId: string, @Body() dto: CreateSosDto) {
    return this.sosService.create(userId, dto);
  }

  @Get('mine')
  @ApiOperation({ summary: 'List SOS requests I raised' })
  listMine(@CurrentUserId() userId: string) {
    return this.sosService.listMine(userId);
  }

  @Get('assigned')
  @ApiOperation({ summary: 'List SOS requests dispatched to me' })
  listAssigned(@CurrentUserId() userId: string) {
    return this.sosService.listAssigned(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one SOS request I can access' })
  get(@Param('id') id: string, @CurrentUserId() userId: string) {
    return this.sosService.get(userId, id);
  }

  @Put(':id/acknowledge')
  @ApiOperation({ summary: 'Acknowledge an SOS dispatched to me' })
  acknowledge(
    @Param('id') id: string,
    @CurrentUserId() userId: string,
    @Body() dto: AcknowledgeSosDto,
  ) {
    return this.sosService.acknowledge(userId, id, dto.note);
  }

  @Put(':id/state')
  @ApiOperation({ summary: 'Resolve or cancel an SOS request' })
  updateState(
    @Param('id') id: string,
    @CurrentUserId() userId: string,
    @Body() dto: UpdateSosStateDto,
  ) {
    return this.sosService.updateState(userId, id, dto);
  }
}
