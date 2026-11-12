import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Community } from './entities/community.entity.js';
import { Responder } from './entities/responder.entity.js';
import { User } from '../identity/entities/user.entity.js';
import { UserRole } from '../identity/interfaces/identity.interface.js';
import {
  AddResponderDto,
  AssignCommunityAdminDto,
  CreateCommunityDto,
  GeoJsonPolygonDto,
  UpdateCommunityDto,
  UpdateResponderDto,
} from './dto/community.dto.js';

@Injectable()
export class CommunityService {
  constructor(
    @InjectRepository(Community)
    private readonly communityRepo: Repository<Community>,
    @InjectRepository(Responder)
    private readonly responderRepo: Repository<Responder>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly db: DataSource,
  ) {}

  async create(actorId: string, dto: CreateCommunityDto) {
    this.assertPolygon(dto.boundary);
    const community = await this.db.transaction(async (manager) => {
      const saved = await manager.save(
        Community,
        manager.create(Community, {
          name: dto.name,
          boundary: dto.boundary as any,
          adminId: actorId,
          plan: dto.plan ?? 'standard',
        }),
      );
      await this.promoteAdmin(manager, actorId, saved.id);
      return saved;
    });
    return this.get(community.id);
  }

  async list() {
    const communities = await this.communityRepo.find({
      where: { status: 'active' },
      relations: ['admin'],
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return communities.map((community) => this.present(community));
  }

  async get(id: string) {
    const community = await this.communityRepo.findOne({
      where: { id },
      relations: ['admin', 'responders', 'responders.user'],
    });
    if (!community) throw new NotFoundException('Community not found');
    return {
      ...this.present(community),
      responders: (community.responders ?? []).map((responder: Responder) =>
        this.presentResponder(responder),
      ),
    };
  }

  async update(actorId: string, id: string, dto: UpdateCommunityDto) {
    const community = await this.findOrFail(id);
    await this.assertCanAdmin(actorId, community);
    if (dto.name !== undefined) community.name = dto.name;
    if (dto.status !== undefined) community.status = dto.status;
    if (dto.plan !== undefined) community.plan = dto.plan;
    if (dto.responderCoverageConfiguration !== undefined)
      community.responderCoverageConfiguration =
        dto.responderCoverageConfiguration;
    await this.communityRepo.save(community);
    return this.get(id);
  }

  async addResponder(actorId: string, id: string, dto: AddResponderDto) {
    const community = await this.findOrFail(id);
    await this.assertCanAdmin(actorId, community);
    const user = await this.userRepo.findOne({ where: { id: dto.userId } });
    if (!user) throw new NotFoundException('User not found');
    if (dto.coverageArea) this.assertPolygon(dto.coverageArea);

    await this.db.transaction(async (manager) => {
      const existing = await manager.findOne(Responder, {
        where: { userId: dto.userId, communityId: id },
      });
      const responder = existing ?? manager.create(Responder, { userId: dto.userId, communityId: id });
      if (dto.qualificationsOrRoleClaims !== undefined)
        responder.qualificationsOrRoleClaims = dto.qualificationsOrRoleClaims;
      if (dto.availabilityWindow !== undefined)
        responder.availabilityWindow = dto.availabilityWindow;
      if (dto.coverageArea !== undefined)
        responder.coverageArea = dto.coverageArea as any;
      await manager.save(Responder, responder);

      if (
        user.role === UserRole.RESIDENT ||
        user.role === UserRole.RESPONDER
      ) {
        user.role = UserRole.RESPONDER;
      }
      user.communityId = id;
      await manager.save(User, user);
    });
    return this.get(id);
  }

  async updateResponder(
    actorId: string,
    id: string,
    userId: string,
    dto: UpdateResponderDto,
  ) {
    const community = await this.findOrFail(id);
    await this.assertCanAdmin(actorId, community);
    const responder = await this.responderRepo.findOne({
      where: { userId, communityId: id },
    });
    if (!responder) throw new NotFoundException('Responder not found');
    if (dto.coverageArea) this.assertPolygon(dto.coverageArea);
    if (dto.qualificationsOrRoleClaims !== undefined)
      responder.qualificationsOrRoleClaims = dto.qualificationsOrRoleClaims;
    if (dto.availabilityWindow !== undefined)
      responder.availabilityWindow = dto.availabilityWindow;
    if (dto.coverageArea !== undefined)
      responder.coverageArea = dto.coverageArea as any;
    if (dto.status !== undefined) responder.status = dto.status;
    await this.responderRepo.save(responder);
    return this.get(id);
  }

  async removeResponder(actorId: string, id: string, userId: string) {
    const community = await this.findOrFail(id);
    await this.assertCanAdmin(actorId, community);
    const result = await this.responderRepo.delete({
      userId,
      communityId: id,
    });
    if (!result.affected) throw new NotFoundException('Responder not found');
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (
      user &&
      user.role === UserRole.RESPONDER &&
      user.communityId === id
    ) {
      user.role = UserRole.RESIDENT;
      user.communityId = null as unknown as string;
      await this.userRepo.save(user);
    }
    return this.get(id);
  }

  async assignAdmin(
    actorId: string,
    id: string,
    dto: AssignCommunityAdminDto,
  ) {
    const community = await this.findOrFail(id);
    await this.assertCanAdmin(actorId, community);
    const user = await this.userRepo.findOne({ where: { id: dto.userId } });
    if (!user) throw new NotFoundException('User not found');
    await this.db.transaction(async (manager) => {
      community.adminId = dto.userId;
      await manager.save(Community, community);
      await this.promoteAdmin(manager, dto.userId, id);
    });
    return this.get(id);
  }

  private async promoteAdmin(
    manager: DataSource['manager'],
    userId: string,
    communityId: string,
  ) {
    const user = await manager.findOne(User, { where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (
      user.role !== UserRole.SUPER_ADMIN &&
      user.role !== UserRole.MODERATOR
    ) {
      user.role = UserRole.COMMUNITY_ADMIN;
    }
    user.communityId = communityId;
    await manager.save(User, user);
  }

  private async assertCanAdmin(actorId: string, community: Community) {
    if (community.adminId === actorId) return;
    const actor = await this.userRepo.findOne({ where: { id: actorId } });
    if (
      actor?.role === UserRole.SUPER_ADMIN ||
      actor?.role === UserRole.MODERATOR
    )
      return;
    throw new ForbiddenException(
      'Only the community admin can perform this action',
    );
  }

  private assertPolygon(polygon: GeoJsonPolygonDto) {
    const ring = polygon?.coordinates?.[0];
    if (!Array.isArray(ring) || ring.length < 4)
      throw new BadRequestException(
        'A polygon ring needs at least four [lng, lat] points',
      );
    const [first, last] = [ring[0], ring[ring.length - 1]];
    if (first[0] !== last[0] || first[1] !== last[1])
      throw new BadRequestException('A polygon ring must be closed');
    for (const point of ring) {
      if (
        !Array.isArray(point) ||
        point.length !== 2 ||
        typeof point[0] !== 'number' ||
        typeof point[1] !== 'number' ||
        point[0] < -180 ||
        point[0] > 180 ||
        point[1] < -90 ||
        point[1] > 90
      )
        throw new BadRequestException('Invalid polygon coordinate');
    }
  }

  private async findOrFail(id: string) {
    const community = await this.communityRepo.findOne({ where: { id } });
    if (!community) throw new NotFoundException('Community not found');
    return community;
  }

  private present(community: Community) {
    return {
      id: community.id,
      name: community.name,
      boundary: community.boundary,
      adminId: community.adminId,
      admin: community.admin
        ? {
            id: community.admin.id,
            displayName: community.admin.displayName,
          }
        : undefined,
      status: community.status,
      plan: community.plan,
      responderCoverageConfiguration:
        community.responderCoverageConfiguration,
      createdAt: community.createdAt,
      responderCount: community.responders?.length,
    };
  }

  private presentResponder(responder: Responder) {
    return {
      userId: responder.userId,
      communityId: responder.communityId,
      qualificationsOrRoleClaims: responder.qualificationsOrRoleClaims,
      availabilityWindow: responder.availabilityWindow,
      coverageArea: responder.coverageArea,
      status: responder.status,
      displayName: responder.user?.displayName,
    };
  }
}
