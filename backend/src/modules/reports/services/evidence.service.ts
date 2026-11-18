import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { AuditService } from '../../audit/audit.service.js';
import { EvidenceAsset } from '../entities/evidence-asset.entity.js';
import { Report } from '../entities/report.entity.js';
import { EvidenceScannerService } from './evidence-scanner.service.js';
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
  private s3?: S3Client;

  constructor(
    @InjectRepository(EvidenceAsset)
    private readonly evidenceRepo: Repository<EvidenceAsset>,
    @InjectRepository(Report)
    private readonly reportRepo: Repository<Report>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly config: ConfigService,
    private readonly scanner: EvidenceScannerService,
    private readonly audit: AuditService,
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

    const safeName = this.safeFileName(fileName);
    const scan = await this.scanner.scan(buffer, safeName);
    const available = scan.state === 'clean';

    const storageKey = `${reportId}/${randomUUID()}.${EXTENSIONS[mimeType]}`;
    if (available) await this.writeObject(storageKey, buffer, mimeType);

    const retentionDeadline = new Date();
    retentionDeadline.setDate(
      retentionDeadline.getDate() + this.retentionDays,
    );
    const asset = await this.evidenceRepo.save(
      this.evidenceRepo.create({
        reportId,
        storageKey,
        mediaMetadata: {
          fileName: safeName,
          mimeType,
          sizeBytes: buffer.length,
        },
        moderationState: 'pending',
        retentionDeadline,
        scanState: scan.state,
        scanEngine: scan.engine,
        scannedAt: scan.scannedAt,
        scanSignature: scan.signature,
      }),
    );
    if (!available) {
      const detail = scan.signature ? ` (${scan.signature})` : '';
      this.logger.warn(
        `Evidence scan ${scan.state} by ${scan.engine}${detail} for asset ${asset.id}`,
      );
      await this.audit.record({
        actorId: userId,
        action: `evidence.scan.${scan.state}`,
        targetId: asset.id,
        source: 'scanner',
        metadata: {
          reportId,
          fileName: safeName,
          engine: scan.engine,
          scannedAt: scan.scannedAt,
          ...(scan.signature ? { signature: scan.signature } : {}),
        },
      });
    }
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
    this.s3?.destroy();
  }

  async runRetention(now = new Date()) {
    const expired = await this.evidenceRepo.find({
      where: { retentionDeadline: LessThan(now) },
      take: 500,
    });
    if (!expired.length) return 0;
    for (const asset of expired) await this.deleteObject(asset.storageKey);
    await this.evidenceRepo.remove(expired);
    this.logger.log(`Removed ${expired.length} expired evidence asset(s)`);
    return expired.length;
  }

  async list(userId: string, reportId: string) {
    await this.findReport(reportId);
    const user = await this.findUser(userId);
    const report = await this.reportRepo.findOneBy({ id: reportId });
    const privileged = this.isModerator(user);
    const canSeePending = report?.reporterId === userId || privileged;
    const assets = await this.evidenceRepo.find({
      where: { reportId },
      order: { id: 'ASC' },
    });
    return assets
      .filter(
        (asset) =>
          (asset.moderationState === 'approved' || canSeePending) &&
          (this.isAvailable(asset) || privileged),
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
    if (!this.isAvailable(asset))
      throw new ForbiddenException(
        'Evidence failed security scanning and is not available',
      );
    const report = await this.findReport(asset.reportId);
    const canSeePending =
      report.reporterId === userId || this.isModerator(user);
    if (asset.moderationState !== 'approved' && !canSeePending)
      throw new ForbiddenException('Evidence is awaiting moderation');
    const buffer = await this.readObject(asset.storageKey);
    return {
      buffer,
      mimeType: asset.mediaMetadata?.mimeType ?? 'application/octet-stream',
      fileName: asset.mediaMetadata?.fileName ?? `${asset.id}`,
    };
  }

  private async writeObject(key: string, buffer: Buffer, mimeType: string) {
    if (this.driver === 'local') {
      const storageDir = resolve(this.storageDir);
      const fullPath = resolve(storageDir, key);
      if (!fullPath.startsWith(storageDir + sep))
        throw new ForbiddenException('Invalid evidence path');
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, buffer);
      return;
    }
    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.s3Bucket,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
          ServerSideEncryption: 'AES256',
        }),
      );
    } catch (error) {
      this.logger.error(
        `S3 evidence upload failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      throw new ServiceUnavailableException('Evidence storage is unavailable.');
    }
  }

  private async readObject(key: string) {
    if (this.driver === 'local') {
      const storageDir = resolve(this.storageDir);
      const fullPath = resolve(storageDir, key);
      if (!fullPath.startsWith(storageDir + sep))
        throw new ForbiddenException('Invalid evidence path');
      try {
        return await readFile(fullPath);
      } catch {
        throw new NotFoundException('Evidence file is missing from storage');
      }
    }
    try {
      const result = await this.s3Client.send(
        new GetObjectCommand({ Bucket: this.s3Bucket, Key: key }),
      );
      const bytes = await result.Body?.transformToByteArray();
      if (!bytes) throw new Error('empty body');
      return Buffer.from(bytes);
    } catch {
      throw new NotFoundException('Evidence file is missing from storage');
    }
  }

  private async deleteObject(key: string) {
    if (this.driver === 'local') {
      const storageDir = resolve(this.storageDir);
      const fullPath = resolve(storageDir, key);
      if (fullPath.startsWith(storageDir + sep))
        await unlink(fullPath).catch(() => {});
      return;
    }
    await this.s3Client
      .send(new DeleteObjectCommand({ Bucket: this.s3Bucket, Key: key }))
      .catch((error) =>
        this.logger.warn(
          `S3 evidence delete failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        ),
      );
  }

  private get s3Client() {
    if (!this.s3) {
      this.s3 = new S3Client({
        region: this.s3Region,
        ...(this.config.get<string>('evidence.s3Endpoint')
          ? { endpoint: this.config.get<string>('evidence.s3Endpoint') }
          : {}),
        ...(this.config.get<string>('evidence.s3AccessKeyId')
          ? {
              credentials: {
                accessKeyId: this.config.get<string>(
                  'evidence.s3AccessKeyId',
                )!,
                secretAccessKey: this.config.get<string>(
                  'evidence.s3SecretAccessKey',
                )!,
              },
            }
          : {}),
        forcePathStyle:
          this.config.get<boolean>('evidence.s3ForcePathStyle') ?? false,
      });
    }
    return this.s3;
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

  private isAvailable(asset: EvidenceAsset) {
    return asset.scanState !== 'infected' && asset.scanState !== 'error';
  }

  private get storageDir() {
    return this.config.get<string>('evidence.storageDir') ?? '.local/evidence';
  }

  private get driver() {
    return this.config.get<string>('evidence.driver') === 's3'
      ? 's3'
      : 'local';
  }

  private get s3Bucket() {
    const bucket = this.config.get<string>('evidence.s3Bucket');
    if (!bucket)
      throw new ServiceUnavailableException(
        'Evidence S3 bucket is not configured.',
      );
    return bucket;
  }

  private get s3Region() {
    return (
      this.config.get<string>('evidence.s3Region') || 'us-east-1'
    );
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
      scanState: asset.scanState ?? 'clean',
      scanEngine: asset.scanEngine ?? null,
      scannedAt: asset.scannedAt ?? null,
      scanSignature: asset.scanSignature ?? null,
    };
  }
}
