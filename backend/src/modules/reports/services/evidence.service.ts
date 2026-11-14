import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { EvidenceAsset } from '../entities/evidence-asset.entity.js';
import { Report } from '../entities/report.entity.js';
import { User } from '../../identity/entities/user.entity.js';
import { UserRole } from '../../identity/interfaces/identity.interface.js';
import {
  ModerateEvidenceDto,
  UploadEvidenceDto,
} from '../dto/evidence.dto.js';

const RETENTION_DAYS = 90;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Injectable()
export class EvidenceService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(EvidenceService.name);
  private retentionTimer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(EvidenceAsset)
    private readonly evidenceRepo: Repository<EvidenceAsset>,
    @InjectRepository(Report)
    private readonly reportRepo: Repository<Report>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly config: ConfigService,
  ) {}

  async upload(userId: string, reportId: string, dto: UploadEvidenceDto) {
    const buffer = this.decode(dto.data);
    if (this.detectMime(buffer) !== dto.mimeType)
      throw new BadRequestException(
        'Evidence contents do not match the declared image type',
      );
    return this.store(userId, reportId, buffer, dto.fileName);
  }

  async uploadFile(
    userId: string,
    reportId: string,
    file?: { buffer?: Buffer; originalname?: string },
  ) {
    if (!file?.buffer?.length)
      throw new BadRequestException('Evidence file is empty');
    return this.store(userId, reportId, file.buffer, file.originalname);
  }

  private async store(
    userId: string,
    reportId: string,
    buffer: Buffer,
    fileName?: string,
  ) {
    const report = await this.findReport(reportId);
    const user = await this.findUser(userId);
    if (report.reporterId !== userId && !this.isModerator(user))
      throw new ForbiddenException(
        'Only the reporter or a moderator can attach evidence',
      );

    const maxBytes = this.maxBytes;
    if (buffer.length === 0)
      throw new BadRequestException('Evidence file is empty');
    if (buffer.length > maxBytes)
      throw new BadRequestException(
        `Evidence file exceeds the ${Math.floor(maxBytes / 1024)}KB limit`,
      );
    const mimeType = this.detectMime(buffer);
    if (!mimeType)
      throw new BadRequestException(
        'Evidence must be a PNG, JPEG or WebP image',
      );

    const storageDir = resolve(this.storageDir);
    const storageKey = join(
      reportId,
      `${randomUUID()}.${EXTENSIONS[mimeType]}`,
    );
    const fullPath = join(storageDir, storageKey);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, buffer);

    const retentionDeadline = new Date();
    retentionDeadline.setDate(
      retentionDeadline.getDate() + this.retentionDays,
    );
    const asset = await this.evidenceRepo.save(
      this.evidenceRepo.create({
        reportId,
        storageKey,
        mediaMetadata: {
          fileName: this.safeFileName(fileName),
          mimeType,
          sizeBytes: buffer.length,
        },
        moderationState: 'pending',
        retentionDeadline,
      }),
    );
    return this.present(asset);
  }

  onModuleInit() {
    if (!this.retentionEnabled) return;
    this.retentionTimer = setInterval(
      () => this.runRetention().catch((error) => this.logger.error(error)),
      this.retentionIntervalMs,
    );
    this.retentionTimer.unref?.();
  }

  onApplicationShutdown() {
    if (this.retentionTimer) clearInterval(this.retentionTimer);
  }

  async runRetention(now = new Date()) {
    const expired = await this.evidenceRepo.find({
      where: { retentionDeadline: LessThan(now) },
      take: 500,
    });
    if (!expired.length) return 0;
    const storageDir = resolve(this.storageDir);
    for (const asset of expired) {
      const fullPath = resolve(storageDir, asset.storageKey);
      if (!fullPath.startsWith(storageDir + sep)) continue;
      await unlink(fullPath).catch(() => {});
    }
    await this.evidenceRepo.remove(expired);
    this.logger.log(`Removed ${expired.length} expired evidence asset(s)`);
    return expired.length;
  }

  async list(userId: string, reportId: string) {
    await this.findReport(reportId);
    const user = await this.findUser(userId);
    const report = await this.reportRepo.findOneBy({ id: reportId });
    const canSeePending =
      report?.reporterId === userId || this.isModerator(user);
    const assets = await this.evidenceRepo.find({
      where: { reportId },
      order: { id: 'ASC' },
    });
    return assets
      .filter(
        (asset) =>
          asset.moderationState === 'approved' || canSeePending,
      )
      .map((asset) => this.present(asset));
  }

  async moderate(
    userId: string,
    evidenceId: string,
    dto: ModerateEvidenceDto,
  ) {
    const user = await this.findUser(userId);
    if (!this.isModerator(user))
      throw new ForbiddenException('Only moderators can review evidence');
    const asset = await this.evidenceRepo.findOneBy({ id: evidenceId });
    if (!asset) throw new NotFoundException('Evidence not found');
    asset.moderationState = dto.moderationState;
    asset.mediaMetadata = {
      ...asset.mediaMetadata,
      moderation: {
        moderatedBy: userId,
        moderatedAt: new Date(),
        ...(dto.reason ? { reason: dto.reason } : {}),
      },
    };
    const saved = await this.evidenceRepo.save(asset);
    return this.present(saved);
  }

  async readFile(userId: string, evidenceId: string) {
    const user = await this.findUser(userId);
    const asset = await this.evidenceRepo.findOneBy({ id: evidenceId });
    if (!asset) throw new NotFoundException('Evidence not found');
    const report = await this.findReport(asset.reportId);
    const canSeePending =
      report.reporterId === userId || this.isModerator(user);
    if (asset.moderationState !== 'approved' && !canSeePending)
      throw new ForbiddenException('Evidence is awaiting moderation');
    const storageDir = resolve(this.storageDir);
    const fullPath = resolve(storageDir, asset.storageKey);
    if (!fullPath.startsWith(storageDir + sep))
      throw new ForbiddenException('Invalid evidence path');
    try {
      const buffer = await readFile(fullPath);
      return {
        buffer,
        mimeType: asset.mediaMetadata?.mimeType ?? 'application/octet-stream',
        fileName: asset.mediaMetadata?.fileName ?? `${asset.id}`,
      };
    } catch {
      throw new NotFoundException('Evidence file is missing from storage');
    }
  }

  private decode(data: string) {
    const base64 = data.includes(',') ? data.split(',').pop()! : data;
    try {
      return Buffer.from(base64, 'base64');
    } catch {
      throw new BadRequestException('Evidence data must be valid base64');
    }
  }

  private detectMime(buffer: Buffer): string | null {
    if (
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    )
      return 'image/jpeg';
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    )
      return 'image/png';
    if (
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    )
      return 'image/webp';
    return null;
  }

  private safeFileName(fileName?: string) {
    const base = (fileName || 'evidence').split(/[\\/]/).pop() || 'evidence';
    return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  }

  private async findReport(id: string) {
    const report = await this.reportRepo.findOneBy({ id });
    if (!report) throw new NotFoundException('Report not found');
    return report;
  }

  private async findUser(id: string) {
    const user = await this.userRepo.findOneBy({ id });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private isModerator(user: User) {
    return (
      user.role === UserRole.MODERATOR || user.role === UserRole.SUPER_ADMIN
    );
  }

  private get storageDir() {
    return this.config.get<string>('evidence.storageDir') ?? '.local/evidence';
  }

  private get maxBytes() {
    return this.config.get<number>('evidence.maxBytes') ?? 5 * 1024 * 1024;
  }

  private get retentionDays() {
    return this.config.get<number>('evidence.retentionDays') ?? RETENTION_DAYS;
  }

  private get retentionEnabled() {
    return this.config.get<boolean>('evidence.retentionEnabled') ?? true;
  }

  private get retentionIntervalMs() {
    return (
      this.config.get<number>('evidence.retentionIntervalMs') ?? 24 * 3600_000
    );
  }

  private present(asset: EvidenceAsset) {
    return {
      id: asset.id,
      reportId: asset.reportId,
      fileName: asset.mediaMetadata?.fileName,
      mimeType: asset.mediaMetadata?.mimeType,
      sizeBytes: asset.mediaMetadata?.sizeBytes,
      moderationState: asset.moderationState,
      retentionDeadline: asset.retentionDeadline,
    };
  }
}
