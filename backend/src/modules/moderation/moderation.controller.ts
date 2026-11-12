import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../identity/guards/roles.guard.js';
import { Roles } from '../identity/decorators/roles.decorator.js';
import { CurrentUserId } from '../identity/decorators/current-user-id.decorator.js';
import { UserRole } from '../identity/interfaces/identity.interface.js';
import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ModerationService } from './moderation.service.js';
import {
  CreateModerationActionDto,
  UpdateModerationActionDto,
  ModerationActionFilterDto,
  CreateAppealDto,
  ReviewAppealDto,
  MergeReportsDto,
  ModerationQueueItemDto,
  ModerationQueueQueryDto,
  QuickApproveDto,
  QuickReasonDto,
  ModerationActionType,
  ModerationTargetType,
  ReportState,
} from './dto/moderation.dto.js';
import { ModerationAction } from './entities/moderation-action.entity.js';

@ApiTags('Moderation')
@ApiBearerAuth()
@Controller('moderation')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.MODERATOR, UserRole.SUPER_ADMIN)
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  // Moderation actions
  @Post('actions')
  @ApiOperation({ summary: 'Create a moderation action' })
  @ApiResponse({ status: 201, description: 'Moderation action created' })
  @ApiResponse({ status: 400, description: 'Invalid state transition' })
  @ApiResponse({ status: 403, description: 'Forbidden - invalid permissions' })
  @ApiResponse({ status: 404, description: 'Target not found' })
  async createAction(
    @Body() dto: CreateModerationActionDto,
    @CurrentUserId() actorId: string,
  ) {
    return this.moderationService.createAction(actorId, dto);
  }

  @Get('actions/:id')
  @ApiOperation({ summary: 'Get a moderation action by ID' })
  @ApiResponse({ status: 200, type: ModerationAction })
  @ApiResponse({ status: 404, description: 'Action not found' })
  async getAction(@Param('id') id: string): Promise<ModerationAction | null> {
    return this.moderationService.getAction(id);
  }

  @Put('actions/:id')
  @ApiOperation({ summary: 'Update a moderation action' })
  @ApiResponse({ status: 200, type: ModerationAction })
  @ApiResponse({
    status: 403,
    description: 'Only original moderator can update',
  })
  @ApiResponse({ status: 404, description: 'Action not found' })
  async updateAction(
    @Param('id') id: string,
    @Body() dto: UpdateModerationActionDto,
    @CurrentUserId() actorId: string,
  ): Promise<ModerationAction | null> {
    return this.moderationService.updateAction(id, actorId, dto);
  }

  @Get('actions')
  @ApiOperation({ summary: 'Filter moderation actions' })
  @ApiResponse({ status: 200, description: 'Paginated action list' })
  async filterActions(@Query() filters: ModerationActionFilterDto) {
    return this.moderationService.filterActions(filters);
  }

  // Moderation queue
  @Get('queue')
  @ApiOperation({ summary: 'Get moderation queue for current moderator' })
  @ApiResponse({ status: 200, type: [ModerationQueueItemDto] })
  async getQueue(
    @CurrentUserId() moderatorId: string,
    @Query() query: ModerationQueueQueryDto,
  ): Promise<ModerationQueueItemDto[]> {
    return this.moderationService.getQueue(
      moderatorId,
      query.targetType,
      query.limit,
      query.offset,
    );
  }

  // Appeals
  @Post('appeals')
  @Roles(...Object.values(UserRole))
  @ApiOperation({ summary: 'Create an appeal for a moderation action' })
  @ApiResponse({ status: 201, description: 'Appeal submitted' })
  @ApiResponse({ status: 400, description: 'Appeal already exists' })
  @ApiResponse({ status: 403, description: 'Only affected user can appeal' })
  @ApiResponse({ status: 404, description: 'Action not found' })
  async createAppeal(
    @Body() dto: CreateAppealDto,
    @CurrentUserId() userId: string,
  ): Promise<ModerationAction> {
    return this.moderationService.createAppeal(userId, dto);
  }

  @Put('appeals/:id/review')
  @ApiOperation({ summary: 'Review an appeal (moderator only)' })
  @ApiResponse({ status: 200, type: ModerationAction })
  @ApiResponse({ status: 403, description: 'Moderator only' })
  @ApiResponse({ status: 404, description: 'No pending appeal found' })
  async reviewAppeal(
    @Param('id') id: string,
    @Body() dto: ReviewAppealDto,
    @CurrentUserId() moderatorId: string,
  ): Promise<ModerationAction> {
    return this.moderationService.reviewAppeal(moderatorId, id, dto);
  }

  @Get('appeals/pending')
  @ApiOperation({ summary: 'Get pending appeals' })
  @ApiResponse({ status: 200, type: [ModerationAction] })
  async getPendingAppeals(): Promise<ModerationAction[]> {
    return this.moderationService.getPendingAppeals();
  }

  // Merge reports
  @Post('reports/merge')
  @ApiOperation({ summary: 'Merge multiple reports into one' })
  @ApiResponse({ status: 200, description: 'Reports merged' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  async mergeReports(
    @Body() dto: MergeReportsDto,
    @CurrentUserId() moderatorId: string,
  ) {
    return this.moderationService.mergeReports(moderatorId, dto);
  }

  // Audit trail
  @Get('audit/:targetId')
  @ApiOperation({ summary: 'Get audit trail for a target' })
  @ApiResponse({ status: 200, type: [ModerationAction] })
  async getAuditTrail(
    @Param('targetId') targetId: string,
  ): Promise<ModerationAction[]> {
    return this.moderationService.getAuditTrail(targetId);
  }

  // Moderator stats
  @Get('stats/:moderatorId')
  @ApiOperation({ summary: 'Get moderation statistics for a moderator' })
  @ApiQuery({
    name: 'since',
    required: false,
    type: String,
    format: 'date-time',
  })
  @ApiResponse({ status: 200, description: 'Action counts by type' })
  async getModeratorStats(
    @Param('moderatorId') moderatorId: string,
    @Query('since') since?: string,
  ): Promise<Record<string, number>> {
    return this.moderationService.getModeratorStats(
      moderatorId,
      since ? new Date(since) : undefined,
    );
  }

  // Quick actions for common moderation tasks
  @Post('reports/:id/approve')
  @ApiOperation({ summary: 'Quick approve a report' })
  @ApiResponse({ status: 200, description: 'Report approved' })
  async quickApprove(
    @Param('id') id: string,
    @CurrentUserId() actorId: string,
    @Body() body: QuickApproveDto,
  ) {
    return this.moderationService.createAction(actorId, {
      targetId: id,
      targetType: ModerationTargetType.REPORT,
      action: ModerationActionType.APPROVE,
      reason: body.reason,
      newState: body.newState || ReportState.VERIFIED,
    });
  }

  @Post('reports/:id/reject')
  @ApiOperation({ summary: 'Quick reject/remove a report' })
  @ApiResponse({ status: 200, description: 'Report rejected' })
  async quickReject(
    @Param('id') id: string,
    @CurrentUserId() actorId: string,
    @Body() body: QuickReasonDto,
  ) {
    return this.moderationService.createAction(actorId, {
      targetId: id,
      targetType: ModerationTargetType.REPORT,
      action: ModerationActionType.REMOVE,
      reason: body.reason,
      newState: 'removed',
    });
  }

  @Post('reports/:id/flag')
  @ApiOperation({ summary: 'Flag a report for review' })
  @ApiResponse({ status: 200, description: 'Report flagged' })
  async flagReport(
    @Param('id') id: string,
    @CurrentUserId() actorId: string,
    @Body() body: QuickReasonDto,
  ) {
    return this.moderationService.createAction(actorId, {
      targetId: id,
      targetType: ModerationTargetType.REPORT,
      action: ModerationActionType.REVIEW,
      reason: body.reason,
      newState: ReportState.UNDER_REVIEW,
    });
  }
}
