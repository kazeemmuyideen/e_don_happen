import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { Report } from '../reports/entities/report.entity.js';
import { NotificationDelivery } from '../notifications/entities/notification-delivery.entity.js';
import { Incident } from '../incidents/entities/incident.entity.js';
import { SOSRequest } from '../sos/entities/sos-request.entity.js';
import { AuditLog } from './entities/audit-log.entity.js';
import {
  AnalyticsQueryDto,
  AuditLogQueryDto,
} from './dto/analytics.dto.js';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Report)
    private readonly reportRepo: Repository<Report>,
    @InjectRepository(NotificationDelivery)
    private readonly deliveryRepo: Repository<NotificationDelivery>,
    @InjectRepository(Incident)
    private readonly incidentRepo: Repository<Incident>,
    @InjectRepository(SOSRequest)
    private readonly sosRepo: Repository<SOSRequest>,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  async reportSummary(query: AnalyticsQueryDto) {
    const since = this.since(query.sinceDays);
    const [byState, byCategory, total, last24h] = await Promise.all([
      this.groupCount(this.reportRepo, 'state', since, 'submitted_at'),
      this.groupCount(
        this.reportRepo,
        'category',
        since,
        'submitted_at',
      ),
      this.reportRepo.count({ where: { submittedAt: MoreThanOrEqual(since) } }),
      this.reportRepo.count({
        where: { submittedAt: MoreThanOrEqual(this.hoursAgo(24)) },
      }),
    ]);
    return { since, total, last24h, byState, byCategory };
  }

  async notificationSummary(query: AnalyticsQueryDto) {
    const since = this.since(query.sinceDays);
    const [byDeliveryState, byChannel, byProvider, total, last24h] =
      await Promise.all([
        this.groupCount(this.deliveryRepo, 'delivery_state', since),
        this.groupCount(this.deliveryRepo, 'channel', since),
        this.groupCount(this.deliveryRepo, 'provider', since),
        this.deliveryRepo.count({
          where: { createdAt: MoreThanOrEqual(since) },
        }),
        this.deliveryRepo.count({
          where: { createdAt: MoreThanOrEqual(this.hoursAgo(24)) },
        }),
      ]);
    return { since, total, last24h, byDeliveryState, byChannel, byProvider };
  }

  async incidentSummary() {
    const [byStatus, byVerification, bySeverity, total] = await Promise.all([
      this.groupCount(this.incidentRepo, 'status'),
      this.groupCount(this.incidentRepo, 'verification_state'),
      this.groupCount(this.incidentRepo, 'severity'),
      this.incidentRepo.count(),
    ]);
    return { total, byStatus, byVerification, bySeverity };
  }

  async sosSummary(query: AnalyticsQueryDto) {
    const since = this.since(query.sinceDays);
    const [byState, total, last24h] = await Promise.all([
      this.groupCount(this.sosRepo, 'state', since, 'created_at'),
      this.sosRepo.count({ where: { createdAt: MoreThanOrEqual(since) } }),
      this.sosRepo.count({
        where: { createdAt: MoreThanOrEqual(this.hoursAgo(24)) },
      }),
    ]);
    return { since, total, last24h, byState };
  }

  async auditLogs(query: AuditLogQueryDto) {
    const where: Record<string, unknown> = {};
    if (query.actorId) where.actorId = query.actorId;
    if (query.action) where.action = query.action;
    if (query.targetId) where.targetId = query.targetId;
    if (query.source) where.source = query.source;
    const [items, total] = await this.auditRepo.findAndCount({
      where,
      relations: ['actor'],
      order: { timestamp: 'DESC' },
      take: query.limit ?? 20,
      skip: query.offset ?? 0,
    });
    return {
      total,
      items: items.map((log) => ({
        id: log.id,
        actorId: log.actorId,
        actorName: log.actor?.displayName,
        action: log.action,
        targetId: log.targetId,
        source: log.source,
        reason: log.reason,
        metadata: log.metadata,
        timestamp: log.timestamp,
      })),
    };
  }

  private async groupCount(
    repo: Repository<any>,
    column: string,
    since?: Date,
    dateColumn = 'created_at',
  ) {
    const builder = repo
      .createQueryBuilder('row')
      .select(`row.${column}`, 'key')
      .addSelect('COUNT(*)', 'count')
      .groupBy(`row.${column}`)
      .orderBy('count', 'DESC');
    if (since) {
      builder.where(`row.${dateColumn} >= :since`, { since });
    }
    const rows = await builder.getRawMany<{ key: string; count: string }>();
    return rows.map((row) => ({ key: row.key, count: Number(row.count) }));
  }

  private since(days?: number) {
    const date = new Date();
    date.setDate(date.getDate() - (days ?? 7));
    return date;
  }

  private hoursAgo(hours: number) {
    const date = new Date();
    date.setHours(date.getHours() - hours);
    return date;
  }
}
