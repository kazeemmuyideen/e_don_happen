import { UserRole } from '../identity/interfaces/identity.interface.js';
import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  NotImplementedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModerationAction } from './entities/moderation-action.entity.js';
import { ModerationRepository } from './repositories/moderation.repository.js';
import { Report } from '../reports/entities/report.entity.js';
import { Incident } from '../incidents/entities/incident.entity.js';
import { User } from '../identity/entities/user.entity.js';
import {
  CreateModerationActionDto,
  UpdateModerationActionDto,
  ModerationActionFilterDto,
  CreateAppealDto,
  ReviewAppealDto,
  MergeReportsDto,
  ModerationQueueItemDto,
  ModerationActionType,
  ModerationTargetType,
  AppealStatus,
  ReportState,
} from './dto/moderation.dto.js';

@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);
  private readonly ALLOWED_STATE_TRANSITIONS: Record<string, string[]> = {
    [ReportState.UNVERIFIED]: [
      ReportState.UNDER_REVIEW,
      ReportState.CORROBORATED,
      ReportState.VERIFIED,
      ReportState.DISPUTED,
      ReportState.REMOVED,
    ],
    [ReportState.UNDER_REVIEW]: [
      ReportState.CORROBORATED,
      ReportState.VERIFIED,
      ReportState.DISPUTED,
      ReportState.UNVERIFIED,
      ReportState.REMOVED,
    ],
    [ReportState.CORROBORATED]: [
      ReportState.VERIFIED,
      ReportState.DISPUTED,
      ReportState.RESOLVED,
      ReportState.REMOVED,
    ],
    [ReportState.VERIFIED]: [
      ReportState.DISPUTED,
      ReportState.RESOLVED,
      ReportState.REMOVED,
    ],
    [ReportState.DISPUTED]: [
      ReportState.CORROBORATED,
      ReportState.VERIFIED,
      ReportState.UNVERIFIED,
      ReportState.REMOVED,
    ],
    [ReportState.STALE]: [ReportState.RESOLVED, ReportState.REMOVED],
    [ReportState.RESOLVED]: [ReportState.REMOVED],
    [ReportState.REMOVED]: [],
  };

  constructor(
    private readonly moderationRepository: ModerationRepository,
    @InjectRepository(Report)
    private readonly reportRepo: Repository<Report>,
    @InjectRepository(Incident)
    private readonly incidentRepo: Repository<Incident>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async createAction(
    actorId: string,
    dto: CreateModerationActionDto,
  ): Promise<{
    action: ModerationAction;
    targetUpdated: boolean;
    message: string;
  }> {
    const actor = await this.userRepo.findOne({ where: { id: actorId } });
    if (!actor) throw new NotFoundException('Actor not found');
    if (![UserRole.MODERATOR, UserRole.SUPER_ADMIN].includes(actor.role))
      throw new ForbiddenException('Moderator role required');
    if (dto.targetType !== ModerationTargetType.REPORT)
      throw new NotImplementedException(
        'Only report moderation is available in the demo',
      );
    const newState =
      dto.newState ||
      (dto.action === ModerationActionType.APPROVE
        ? ReportState.VERIFIED
        : dto.action === ModerationActionType.REMOVE ||
            dto.action === ModerationActionType.REJECT
          ? ReportState.REMOVED
          : dto.action === ModerationActionType.REVIEW
            ? ReportState.UNDER_REVIEW
            : undefined);
    if (!newState)
      throw new BadRequestException('A new report state is required');
    if (!Object.values(ReportState).includes(newState as ReportState))
      throw new BadRequestException('Unknown report state');
    return this.reportRepo.manager.transaction(async (manager) => {
      const report = await manager.findOne(Report, {
        where: { id: dto.targetId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!report) throw new NotFoundException('Report not found');
      if (report.reporterId === actorId)
        throw new ForbiddenException(
          'Moderators cannot verify their own reports',
        );
      if (
        !(this.ALLOWED_STATE_TRANSITIONS[report.state] || []).includes(newState)
      )
        throw new BadRequestException('Invalid report state transition');
      const previousState = report.state;
      report.state = newState;
      await manager.save(report);
      const action = await manager.save(
        ModerationAction,
        manager.create(ModerationAction, {
          actorId,
          targetId: report.id,
          targetType: 'report',
          action: dto.action,
          reason: dto.reason,
          appealStatus: AppealStatus.NONE,
          metadata: { previousState, newState },
        }),
      );
      return {
        action,
        targetUpdated: true,
        message: 'Report updated and audit record saved',
      };
    });
  }

  async getAction(id: string): Promise<ModerationAction | null> {
    return this.moderationRepository.findById(id);
  }

  async updateAction(
    id: string,
    actorId: string,
    dto: UpdateModerationActionDto,
  ): Promise<ModerationAction | null> {
    const action = await this.moderationRepository.findById(id);
    if (!action) {
      throw new NotFoundException('Moderation action not found');
    }
    if (action.actorId !== actorId) {
      const actor = await this.userRepo.findOne({ where: { id: actorId } });
      if (actor?.role !== UserRole.SUPER_ADMIN) {
        throw new ForbiddenException(
          'Only the original moderator or a super admin can update this action',
        );
      }
    }
    return this.moderationRepository.update(id, {
      reason: dto.reason,
      appealStatus: dto.appealStatus as any,
      metadata: { ...action.metadata, ...dto.metadata },
    });
  }

  async filterActions(
    filters: ModerationActionFilterDto,
  ): Promise<{ data: ModerationAction[]; total: number }> {
    return this.moderationRepository.filterActions(filters);
  }

  async getQueue(
    _moderatorId: string,
    targetType?: ModerationTargetType,
    limit = 50,
    offset = 0,
  ): Promise<ModerationQueueItemDto[]> {
    if (targetType && targetType !== ModerationTargetType.REPORT) return [];
    const reports = await this.reportRepo.find({
      where: [
        { state: ReportState.UNDER_REVIEW },
        { state: ReportState.UNVERIFIED },
        { state: ReportState.DISPUTED },
        { state: ReportState.CORROBORATED },
      ],
      order: { submittedAt: 'DESC' },
      take: Math.min(100, Math.max(1, limit)),
      skip: Math.max(0, offset),
    });
    return reports.map(
      (report) =>
        new ModerationQueueItemDto({
          id: report.id,
          targetType: ModerationTargetType.REPORT,
          targetPreview: report.description.slice(0, 160),
          targetState: report.state,
          currentState: report.state,
          submittedAt: report.submittedAt,
          reporterId: report.reporterId,
        }),
    );
  }

  async createAppeal(
    userId: string,
    dto: CreateAppealDto,
  ): Promise<ModerationAction> {
    const action = await this.moderationRepository.findById(
      dto.moderationActionId,
    );
    if (!action) {
      throw new NotFoundException('Moderation action not found');
    }
    if (action.targetType !== ModerationTargetType.REPORT) {
      throw new BadRequestException('Only report actions can be appealed');
    }
    const report = await this.reportRepo.findOne({
      where: { id: action.targetId },
    });
    if (!report) throw new NotFoundException('Report not found');
    if (report.reporterId !== userId) {
      throw new ForbiddenException(
        'Only the affected community member can appeal this action',
      );
    }
    if (action.appealStatus !== AppealStatus.NONE) {
      throw new BadRequestException('An appeal is already recorded');
    }
    const updated = await this.moderationRepository.update(
      dto.moderationActionId,
      {
        appealStatus: AppealStatus.PENDING,
        metadata: {
          ...action.metadata,
          appeal: {
            userId,
            reason: dto.reason,
            evidence: dto.evidence,
            submittedAt: new Date(),
          },
        },
      },
    );
    if (!updated)
      throw new NotFoundException('Failed to update moderation action');
    return updated;
  }

  async getPendingAppeals(): Promise<ModerationAction[]> {
    return this.moderationRepository.getAppealActions(AppealStatus.PENDING);
  }

  async reviewAppeal(
    moderatorId: string,
    actionId: string,
    dto: ReviewAppealDto,
  ): Promise<ModerationAction> {
    const action = await this.moderationRepository.findById(actionId);
    if (!action) throw new NotFoundException('Moderation action not found');
    if (action.appealStatus !== AppealStatus.PENDING) {
      throw new BadRequestException('No pending appeal for this action');
    }

    if (dto.decision === AppealStatus.APPROVED) {
      const previousState = action.metadata?.previousState;
      if (
        action.targetType === ModerationTargetType.REPORT &&
        Object.values(ReportState).includes(previousState)
      ) {
        await this.reportRepo.update(action.targetId, {
          state: previousState as ReportState,
        });
      }
    }

    const updated = await this.moderationRepository.update(actionId, {
      appealStatus: dto.decision,
      metadata: {
        ...action.metadata,
        appealReview: {
          moderatorId,
          decision: dto.decision,
          reason: dto.reason,
          reviewedAt: new Date(),
        },
      },
    });
    if (!updated)
      throw new NotFoundException('Failed to update moderation action');
    return updated;
  }

  async mergeReports(
    moderatorId: string,
    dto: MergeReportsDto,
  ): Promise<{
    action: ModerationAction;
    targetUpdated: boolean;
    message: string;
  }> {
    if (dto.reportIds.length < 2) {
      throw new BadRequestException('At least two reports are required');
    }
    return this.reportRepo.manager.transaction(async (manager) => {
      const reports = await manager
        .getRepository(Report)
        .createQueryBuilder('report')
        .where('report.id IN (:...ids)', { ids: dto.reportIds })
        .setLock('pessimistic_write')
        .getMany();
      if (reports.length !== new Set(dto.reportIds).size) {
        throw new NotFoundException('One or more reports were not found');
      }
      const [primary, ...duplicates] = reports;
      for (const duplicate of duplicates) {
        duplicate.state = ReportState.REMOVED;
        duplicate.metadata = {
          ...duplicate.metadata,
          duplicateOf: primary.id,
        };
        await manager.save(duplicate);
      }
      const action = await manager.save(
        ModerationAction,
        manager.create(ModerationAction, {
          actorId: moderatorId,
          targetId: primary.id,
          targetType: 'report',
          action: ModerationActionType.MERGE,
          reason: dto.reason,
          appealStatus: AppealStatus.NONE,
          metadata: {
            mergedReportIds: duplicates.map((report) => report.id),
          },
        }),
      );
      return {
        action,
        targetUpdated: true,
        message: 'Duplicate reports merged into the primary report',
      };
    });
  }

  async getAuditTrail(targetId: string): Promise<ModerationAction[]> {
    return this.moderationRepository.getActionHistoryForTarget(targetId);
  }

  async getModeratorStats(
    moderatorId: string,
    since?: Date,
  ): Promise<Record<string, number>> {
    return this.moderationRepository.countActionsByActor(moderatorId, since);
  }
}
