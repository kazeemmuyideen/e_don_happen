import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
export class EvidenceService {
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
    const report = await this.findReport(reportId);
    const user = await this.findUser(userId);
    if (report.reporterId !== userId && !this.isModerator(user))
      throw new ForbiddenException(
        'Only the reporter or a moderator can attach evidence',
      );

    const buffer = this.decode(dto.data);
    const maxBytes = this.maxBytes;
    if (buffer.length === 0)
      throw new BadRequestException('Evidence file is empty');
    if (buffer.length > maxBytes)
      throw new BadRequestException(
        `Evidence file exceeds the ${Math.floor(maxBytes / 1024)}KB limit`,
      );
    this.assertMagicBytes(buffer, dto.mimeType);

    const storageDir = resolve(this.storageDir);
    const storageKey = join(
      reportId,
      `${randomUUID()}.${EXTENSIONS[dto.mimeType]}`,
    );
    const fullPath = join(storageDir, storageKey);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, buffer);

    const retentionDeadline = new Date();
    retentionDeadline.setDate(retentionDeadline.getDate() + RETENTION_DAYS);
    const asset = await this.evidenceRepo.save(
      this.evidenceRepo.create({
        reportId,
        storageKey,
        mediaMetadata: {
          fileName: dto.fileName,
          mimeType: dto.mimeType,
          sizeBytes: buffer.length,
          ...dto.mediaMetadata,
        },
        moderationState: 'pending',
        retentionDeadline,
      }),
    );
    return this.present(asset);
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

  private assertMagicBytes(buffer: Buffer, mimeType: string) {
    const valid =
      (mimeType === 'image/jpeg' &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff) ||
      (mimeType === 'image/png' &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47) ||
      (mimeType === 'image/webp' &&
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP');
    if (!valid)
      throw new BadRequestException(
        'Evidence contents do not match the declared image type',
      );
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

  private present(asset: EvidenceAsset) {
    return {
      id: asset.id,
      reportId: asset.reportId,
      storageKey: asset.storageKey,
      fileName: asset.mediaMetadata?.fileName,
      mimeType: asset.mediaMetadata?.mimeType,
      sizeBytes: asset.mediaMetadata?.sizeBytes,
      moderationState: asset.moderationState,
      retentionDeadline: asset.retentionDeadline,
    };
  }
}
