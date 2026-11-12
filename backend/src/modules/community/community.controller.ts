import {
  Body,
  Controller,
  Delete,
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
  ApiTags,
} from '@nestjs/swagger';
import { RolesGuard } from '../identity/guards/roles.guard.js';
import { Roles } from '../identity/decorators/roles.decorator.js';
import { CurrentUserId } from '../identity/decorators/current-user-id.decorator.js';
import { UserRole } from '../identity/interfaces/identity.interface.js';
import { CommunityService } from './community.service.js';
import {
  AddResponderDto,
  AssignCommunityAdminDto,
  CreateCommunityDto,
  UpdateCommunityDto,
  UpdateResponderDto,
} from './dto/community.dto.js';

const ADMIN_ROLES = [
  UserRole.COMMUNITY_ADMIN,
  UserRole.MODERATOR,
  UserRole.SUPER_ADMIN,
];

@ApiTags('Communities')
@Controller('communities')
export class CommunityController {
  constructor(private readonly communityService: CommunityService) {}

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(...Object.values(UserRole))
  @ApiOperation({ summary: 'Create a community; the creator becomes admin' })
  create(@CurrentUserId() userId: string, @Body() dto: CreateCommunityDto) {
    return this.communityService.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List active communities' })
  list() {
    return this.communityService.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a community with responders' })
  get(@Param('id') id: string) {
    return this.communityService.get(id);
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Update community settings' })
  update(
    @Param('id') id: string,
    @CurrentUserId() userId: string,
    @Body() dto: UpdateCommunityDto,
  ) {
    return this.communityService.update(userId, id, dto);
  }

  @Post(':id/responders')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Add or update a community responder' })
  addResponder(
    @Param('id') id: string,
    @CurrentUserId() userId: string,
    @Body() dto: AddResponderDto,
  ) {
    return this.communityService.addResponder(userId, id, dto);
  }

  @Put(':id/responders/:userId')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Update a community responder' })
  updateResponder(
    @Param('id') id: string,
    @Param('userId') responderUserId: string,
    @CurrentUserId() userId: string,
    @Body() dto: UpdateResponderDto,
  ) {
    return this.communityService.updateResponder(
      userId,
      id,
      responderUserId,
      dto,
    );
  }

  @Delete(':id/responders/:userId')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Remove a community responder' })
  removeResponder(
    @Param('id') id: string,
    @Param('userId') responderUserId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.communityService.removeResponder(userId, id, responderUserId);
  }

  @Put(':id/admin')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Transfer community admin role' })
  assignAdmin(
    @Param('id') id: string,
    @CurrentUserId() userId: string,
    @Body() dto: AssignCommunityAdminDto,
  ) {
    return this.communityService.assignAdmin(userId, id, dto);
  }
}
