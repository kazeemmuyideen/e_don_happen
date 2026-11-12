import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModerationAction } from '../entities/moderation-action.entity.js';
import {
  ModerationActionType,
  ModerationTargetType,
  AppealStatus,
  ModerationActionFilterDto,
} from '../dto/moderation.dto.js';

@Injectable()
export class ModerationRepository {
  constructor(
    @InjectRepository(ModerationAction)
    private readonly repo: Repository<ModerationAction>,
  ) {}

  async create(action: Partial<ModerationAction>): Promise<ModerationAction> {
    const newAction = this.repo.create(action);
    return this.repo.save(newAction);
  }

  async findById(id: string): Promise<ModerationAction | null> {
    return this.repo.findOne({ where: { id } });
  }

  async update(id: string, updates: Partial<ModerationAction>): Promise<ModerationAction | null> {
    await this.repo.update(id, updates);
    return this.findById(id);
  }

  async findByTarget(targetId: string, targetType: ModerationTargetType): Promise<ModerationAction[]> {
    return this.repo.find({
      where: { targetId, targetType: targetType as any },
      order: { timestamp: 'DESC' },
    });
  }

  async filterActions(filters: ModerationActionFilterDto): Promise<{ data: ModerationAction[]; total: number }> {
    const qb = this.repo.createQueryBuilder('ma');

    if (filters.actorId) qb.andWhere('ma.actorId = :actorId', { actorId: filters.actorId });
    if (filters.targetId) qb.andWhere('ma.targetId = :targetId', { targetId: filters.targetId });
    if (filters.targetType) qb.andWhere('ma.targetType = :targetType', { targetType: filters.targetType });
    if (filters.action) qb.andWhere('ma.action = :action', { action: filters.action });
    if (filters.appealStatus) qb.andWhere('ma.appealStatus = :appealStatus', { appealStatus: filters.appealStatus });
    if (filters.since) qb.andWhere('ma.timestamp >= :since', { since: new Date(filters.since) });
    if (filters.until) qb.andWhere('ma.timestamp <= :until', { until: new Date(filters.until) });

    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));

    qb.orderBy('ma.timestamp', 'DESC');
    qb.skip((page - 1) * limit);
    qb.take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async getActionsByActor(actorId: string): Promise<ModerationAction[]> {
    return this.repo.find({ where: { actorId }, order: { timestamp: 'DESC' } });
  }

  async getRecentActions(limit = 50): Promise<ModerationAction[]> {
    return this.repo.find({
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }

  async countActionsByType(targetType: ModerationTargetType, action: ModerationActionType, since?: Date): Promise<number> {
    const qb = this.repo.createQueryBuilder('ma').where('ma.targetType = :targetType', { targetType }).andWhere('ma.action = :action', { action });
    if (since) qb.andWhere('ma.timestamp >= :since', { since });
    return qb.getCount();
  }

  async countActionsByActor(
    actorId: string,
    since?: Date,
  ): Promise<Record<string, number>> {
    const qb = this.repo
      .createQueryBuilder('ma')
      .select('ma.action', 'action')
      .addSelect('COUNT(*)', 'count')
      .where('ma.actorId = :actorId', { actorId })
      .groupBy('ma.action');
    if (since) qb.andWhere('ma.timestamp >= :since', { since });
    const rows = await qb.getRawMany();
    return rows.reduce(
      (acc, row) => ({ ...acc, [row.action]: Number(row.count) }),
      {},
    );
  }

  async getAppealActions(status: AppealStatus = AppealStatus.PENDING): Promise<ModerationAction[]> {
    return this.repo.find({
      where: { appealStatus: status },
      order: { timestamp: 'ASC' },
    });
  }

  async getActionHistoryForTarget(targetId: string): Promise<ModerationAction[]> {
    return this.repo.find({
      where: { targetId },
      order: { timestamp: 'ASC' },
    });
  }
}