import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SOSRequest } from '../entities/sos-request.entity.js';
import { SOSRecipient } from '../entities/sos-recipient.entity.js';
import { SosEscalationEvent } from '../entities/sos-escalation-event.entity.js';
import { NotificationDelivery } from '../../notifications/entities/notification-delivery.entity.js';
import { OPEN_SOS_STATES } from '../dto/sos.dto.js';
import {
  DEFAULT_ESCALATION_POLICY,
  EscalationPolicyDto,
} from '../dto/escalation-policy.dto.js';

@Injectable()
export class SosEscalationService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(SosEscalationService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(SOSRequest)
    private readonly sosRepo: Repository<SOSRequest>,
    @InjectRepository(SOSRecipient)
    private readonly recipientRepo: Repository<SOSRecipient>,
    @InjectRepository(SosEscalationEvent)
    private readonly eventRepo: Repository<SosEscalationEvent>,
    @InjectRepository(NotificationDelivery)
    private readonly deliveryRepo: Repository<NotificationDelivery>,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (!this.enabled) return;
    this.timer = setInterval(() => {
      void this.runOnce().catch((error) => this.logger.error(error));
    }, this.pollMs);
    this.timer.unref?.();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async runOnce(now = new Date()): Promise<number> {
    if (!this.enabled) return 0;

    const requests = await this.sosRepo.find({
      where: { state: In(OPEN_SOS_STATES) },
    });
    if (requests.length === 0) return 0;

    let created = 0;
    for (const sos of requests) {
      const acknowledged = await this.recipientRepo.existsBy({
        sosId: sos.id,
        acknowledgementState: 'acknowledged',
      });
      if (acknowledged) continue;

      const policy = (sos.escalationPolicy ?? {}) as Partial<EscalationPolicyDto>;
      const escalateAfterMinutes = this.intSetting(
        policy.escalateAfterMinutes,
        DEFAULT_ESCALATION_POLICY.escalateAfterMinutes,
        1,
        1440,
      );
      const policyLevels = this.intSetting(
        policy.maxLevels,
        DEFAULT_ESCALATION_POLICY.maxLevels,
        1,
        5,
      );
      const maxLevels = Math.min(policyLevels, this.maxLevels);

      const createdAt =
        sos.createdAt instanceof Date
          ? sos.createdAt.getTime()
          : new Date(sos.createdAt as unknown as string).getTime();
      const startedAt = Number.isFinite(createdAt) ? createdAt : now.getTime();

      for (let level = 1; level <= maxLevels; level += 1) {
        const dueAt = new Date(
          startedAt + escalateAfterMinutes * level * 60_000,
        );
        if (dueAt.getTime() > now.getTime()) continue;

        const alreadyRecorded = await this.eventRepo.existsBy({
          sosId: sos.id,
          level,
        });
        if (alreadyRecorded) continue;

        await this.eventRepo.save(
          this.eventRepo.create({
            sosId: sos.id,
            level,
            dueAt,
            firedAt: now,
            channel: 'in_app',
            recipientId: sos.requesterId,
            providerMessageId: null,
            outcome: 'notified',
            metadata: {
              incidentType: sos.incidentType,
              escalateAfterMinutes,
            },
          }),
        );

        await this.deliveryRepo.save(
          this.deliveryRepo.create({
            incidentIdOrSosId: sos.id,
            recipientId: sos.requesterId,
            channel: 'in_app',
            provider: 'local-inbox',
            attempt: 1,
            deliveryState: 'delivered',
            pushState: 'queued',
            timestamps: { deliveredAt: now },
            payload: {
              sosId: sos.id,
              level,
              title: `SOS escalation level ${level}`,
              body: `Your ${sos.incidentType} SOS is still open. Escalation level ${level} has been triggered.`,
            },
          }),
        );
        created += 1;
      }
    }
    return created;
  }

  private get enabled(): boolean {
    return this.config.get<boolean>('sos.escalationEnabled') === true;
  }

  private get pollMs(): number {
    return this.intSetting(
      this.config.get<number>('sos.escalationPollMs'),
      60_000,
      1000,
      3_600_000,
    );
  }

  private get maxLevels(): number {
    return this.intSetting(
      this.config.get<number>('sos.escalationMaxLevels'),
      DEFAULT_ESCALATION_POLICY.maxLevels,
      0,
      5,
    );
  }

  private intSetting(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(parsed)));
  }
}
