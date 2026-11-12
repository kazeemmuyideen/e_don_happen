import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SOSRequest } from './entities/sos-request.entity.js';
import { SOSRecipient } from './entities/sos-recipient.entity.js';
import { Responder } from '../community/entities/responder.entity.js';
import { Community } from '../community/entities/community.entity.js';
import { User } from '../identity/entities/user.entity.js';
import { UserRole } from '../identity/interfaces/identity.interface.js';
import { NotificationDelivery } from '../notifications/entities/notification-delivery.entity.js';
import {
  CreateSosDto,
  OPEN_SOS_STATES,
  SosState,
  UpdateSosStateDto,
} from './dto/sos.dto.js';

interface NearbyRecipient {
  userId: string;
  role: 'responder' | 'community_admin';
}

@Injectable()
export class SosService {
  private readonly logger = new Logger(SosService.name);

  constructor(
    @InjectRepository(SOSRequest)
    private readonly sosRepo: Repository<SOSRequest>,
    @InjectRepository(SOSRecipient)
    private readonly recipientRepo: Repository<SOSRecipient>,
    @InjectRepository(Responder)
    private readonly responderRepo: Repository<Responder>,
    @InjectRepository(Community)
    private readonly communityRepo: Repository<Community>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly db: DataSource,
  ) {}

  async create(requesterId: string, dto: CreateSosDto) {
    const sos = await this.db.transaction(async (manager) => {
      const saved = await manager.save(
        SOSRequest,
        manager.create(SOSRequest, {
          requesterId,
          incidentType: dto.incidentType,
          locationSnapshot: {
            type: 'Point',
            coordinates: [dto.longitude, dto.latitude],
          } as any,
          sharingPolicy: dto.sharingPolicy ?? { scope: 'nearby_responders' },
          escalationPolicy: dto.escalationPolicy ?? {
            acknowledgeWithinMinutes: 10,
            escalateAfterMinutes: 15,
          },
          state: SosState.ACTIVE,
        }),
      );

      const nearby = await this.findNearbyRecipients(
        dto.latitude,
        dto.longitude,
      );
      const recipients = nearby.filter((r) => r.userId !== requesterId);
      if (recipients.length === 0) {
        this.logger.warn(
          `SOS ${saved.id} created with no nearby responders or community admins`,
        );
      }

      for (const recipient of recipients) {
        await manager.save(
          SOSRecipient,
          manager.create(SOSRecipient, {
            sosId: saved.id,
            recipientId: recipient.userId,
            role: recipient.role,
            channel: 'in_app',
            deliveryState: 'delivered',
            acknowledgementState: 'unacknowledged',
            timestamps: { enqueuedAt: new Date(), deliveredAt: new Date() },
          }),
        );
        await manager.save(
          NotificationDelivery,
          manager.create(NotificationDelivery, {
            incidentIdOrSosId: saved.id,
            recipientId: recipient.userId,
            channel: 'in_app',
            provider: 'local-inbox',
            attempt: 1,
            deliveryState: 'delivered',
            pushState: 'queued',
            timestamps: { deliveredAt: new Date() },
            payload: {
              title: `SOS: ${dto.incidentType}`,
              body:
                dto.message ||
                'A neighbour needs urgent help near your coverage area.',
              sosId: saved.id,
            },
          }),
        );
      }

      return saved;
    });

    return this.get(requesterId, sos.id);
  }

  private async findNearbyRecipients(
    latitude: number,
    longitude: number,
  ): Promise<NearbyRecipient[]> {
    const rows: NearbyRecipient[] = await this.responderRepo.manager.query(
      `SELECT DISTINCT r.user_id AS "userId", 'responder' AS role
         FROM responders r
         JOIN communities c ON c.id = r.community_id
        WHERE r.status = 'active'
          AND (
            (r.coverage_area IS NOT NULL AND ST_Contains(r.coverage_area, ST_SetSRID(ST_MakePoint($1, $2), 4326)))
            OR ST_Contains(c.boundary, ST_SetSRID(ST_MakePoint($1, $2), 4326))
          )
        UNION
       SELECT DISTINCT c.admin_id AS "userId", 'community_admin' AS role
         FROM communities c
        WHERE ST_Contains(c.boundary, ST_SetSRID(ST_MakePoint($1, $2), 4326))`,
      [longitude, latitude],
    );
    return rows;
  }

  async get(userId: string, id: string) {
    const sos = await this.sosRepo.findOne({
      where: { id },
      relations: ['requester', 'recipients', 'recipients.recipient'],
    });
    if (!sos) throw new NotFoundException('SOS request not found');
    const isRecipient = sos.recipients?.some(
      (r: SOSRecipient) => r.recipientId === userId,
    );
    const user = await this.userRepo.findOne({ where: { id: userId } });
    const privileged =
      user?.role === UserRole.MODERATOR ||
      user?.role === UserRole.SUPER_ADMIN ||
      user?.role === UserRole.COMMUNITY_ADMIN;
    if (sos.requesterId !== userId && !isRecipient && !privileged)
      throw new ForbiddenException('You cannot view this SOS request');
    return this.present(sos);
  }

  async listMine(userId: string) {
    const requests = await this.sosRepo.find({
      where: { requesterId: userId },
      relations: ['requester'],
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return requests.map((sos) => this.present(sos));
  }

  async listAssigned(userId: string) {
    const recipients = await this.recipientRepo.find({
      where: { recipientId: userId },
      relations: ['sosRequest', 'sosRequest.requester'],
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return recipients
      .filter((recipient) => recipient.sosRequest)
      .map((recipient) => ({
        ...this.present(recipient.sosRequest),
        myRole: recipient.role,
        acknowledgementState: recipient.acknowledgementState,
      }));
  }

  async acknowledge(userId: string, sosId: string, note?: string) {
    const sos = await this.sosRepo.findOne({ where: { id: sosId } });
    if (!sos) throw new NotFoundException('SOS request not found');
    if (!OPEN_SOS_STATES.includes(sos.state as SosState))
      throw new BadRequestException('This SOS request is already closed');
    const recipient = await this.recipientRepo.findOne({
      where: { sosId, recipientId: userId },
    });
    if (!recipient)
      throw new ForbiddenException('You are not a recipient of this SOS');
    recipient.acknowledgementState = 'acknowledged';
    recipient.timestamps = {
      ...recipient.timestamps,
      acknowledgedAt: new Date(),
      ...(note ? { acknowledgementNote: note } : {}),
    };
    await this.recipientRepo.save(recipient);
    if (sos.state === SosState.ACTIVE) {
      sos.state = SosState.ACKNOWLEDGED;
      await this.sosRepo.save(sos);
    }
    return this.get(userId, sosId);
  }

  async updateState(userId: string, sosId: string, dto: UpdateSosStateDto) {
    const sos = await this.sosRepo.findOne({ where: { id: sosId } });
    if (!sos) throw new NotFoundException('SOS request not found');
    const user = await this.userRepo.findOne({ where: { id: userId } });
    const privileged =
      user?.role === UserRole.MODERATOR ||
      user?.role === UserRole.SUPER_ADMIN;
    if (sos.requesterId !== userId && !privileged)
      throw new ForbiddenException('Only the requester can close this SOS');
    if (!OPEN_SOS_STATES.includes(sos.state as SosState))
      throw new BadRequestException('This SOS request is already closed');
    sos.state = dto.state;
    if (dto.reason) {
      sos.escalationPolicy = {
        ...sos.escalationPolicy,
        closeReason: dto.reason,
        closedAt: new Date(),
      };
    }
    await this.sosRepo.save(sos);
    return this.get(userId, sosId);
  }

  private present(sos: SOSRequest) {
    const coordinates = (sos.locationSnapshot as any)?.coordinates;
    return {
      id: sos.id,
      requesterId: sos.requesterId,
      incidentType: sos.incidentType,
      state: sos.state,
      location:
        Array.isArray(coordinates) && coordinates.length === 2
          ? {
              type: 'Point',
              coordinates: [
                Math.round(coordinates[0] * 100) / 100,
                Math.round(coordinates[1] * 100) / 100,
              ],
            }
          : sos.locationSnapshot,
      sharingPolicy: sos.sharingPolicy,
      escalationPolicy: sos.escalationPolicy,
      createdAt: sos.createdAt,
      requester: sos.requester
        ? {
            id: sos.requester.id,
            displayName: sos.requester.displayName,
          }
        : undefined,
      recipients: (sos.recipients ?? []).map((recipient: SOSRecipient) => ({
        recipientId: recipient.recipientId,
        role: recipient.role,
        channel: recipient.channel,
        deliveryState: recipient.deliveryState,
        acknowledgementState: recipient.acknowledgementState,
        displayName: recipient.recipient?.displayName,
        timestamps: recipient.timestamps,
      })),
    };
  }
}
