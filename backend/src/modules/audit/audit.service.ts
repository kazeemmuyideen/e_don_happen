import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../analytics/entities/audit-log.entity.js';

export interface AuditEvent {
  actorId: string;
  action: string;
  targetId?: string | null;
  source?: string;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  async record(event: AuditEvent) {
    try {
      const log = new AuditLog();
      log.actorId = event.actorId;
      log.action = event.action;
      log.targetId = (event.targetId ?? null) as string;
      log.source = event.source ?? 'api';
      log.reason = (event.reason ?? null) as string;
      log.metadata = event.metadata ?? null;
      await this.auditRepo.save(log);
    } catch (error) {
      this.logger.error(
        `Failed to write audit event ${event.action}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
