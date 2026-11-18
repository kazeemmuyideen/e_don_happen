import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditService } from '../../audit/audit.service.js';
import { EvidenceService } from './evidence.service.js';
import { EvidenceScannerService } from './evidence-scanner.service.js';
import { EvidenceAsset } from '../entities/evidence-asset.entity.js';
import { Report } from '../entities/report.entity.js';
import { User } from '../../identity/entities/user.entity.js';
import { UserRole } from '../../identity/interfaces/identity.interface.js';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe('EvidenceService', () => {
  let service: EvidenceService;
  let evidenceRepo: any;
  let reportRepo: any;
  let userRepo: any;
  let scanner: any;
  let audit: any;
  let storageDir: string;

  const scannedAt = () => new Date('2026-01-01T00:00:00.000Z');

  const cleanScan = () => ({
    state: 'clean' as const,
    engine: 'passthrough',
    scannedAt: scannedAt(),
  });

  const makeAsset = (overrides: Record<string, unknown> = {}) => ({
    id: 'ev-1',
    reportId: 'report-1',
    storageKey: 'report-1/file.png',
    mediaMetadata: {
      fileName: 'photo.png',
      mimeType: 'image/png',
      sizeBytes: 68,
    },
    moderationState: 'pending',
    retentionDeadline: new Date(),
    scanState: 'clean',
    scanEngine: 'passthrough',
    scannedAt: scannedAt(),
    scanSignature: null,
    ...overrides,
  });

  beforeEach(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'signal-evidence-'));
    evidenceRepo = {
      create: vi.fn((value) => ({ ...value })),
      save: vi.fn(async (value) => ({ ...value, id: 'ev-1' })),
      findOneBy: vi.fn().mockResolvedValue(makeAsset()),
      find: vi.fn().mockResolvedValue([makeAsset()]),
    };
    reportRepo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: 'report-1',
        reporterId: 'user-1',
      }),
    };
    userRepo = {
      findOneBy: vi.fn(async ({ id }) => {
        if (id === 'mod-1')
          return { id: 'mod-1', role: UserRole.MODERATOR };
        if (id === 'user-1')
          return { id: 'user-1', role: UserRole.RESIDENT };
        return { id, role: UserRole.RESIDENT };
      }),
    };
    scanner = { scan: vi.fn().mockResolvedValue(cleanScan()) };
    audit = { record: vi.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvidenceService,
        {
          provide: getRepositoryToken(EvidenceAsset),
          useValue: evidenceRepo,
        },
        { provide: getRepositoryToken(Report), useValue: reportRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((key: string) =>
              key === 'evidence.storageDir' ? storageDir : 1024,
            ),
          },
        },
        { provide: EvidenceScannerService, useValue: scanner },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get(EvidenceService);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await rm(storageDir, { recursive: true, force: true });
  });

  it('stores an uploaded image and records a clean pending asset', async () => {
    const result = await service.upload('user-1', 'report-1', {
      fileName: 'photo.png',
      mimeType: 'image/png',
      data: PNG_BASE64,
    });

    const saved = evidenceRepo.save.mock.calls[0][0];
    expect(saved.moderationState).toBe('pending');
    expect(saved.mediaMetadata.sizeBytes).toBeGreaterThan(0);
    expect(saved.scanState).toBe('clean');
    expect(saved.scanEngine).toBe('passthrough');
    expect(saved.scannedAt).toEqual(scannedAt());
    const stored = await readFile(join(storageDir, saved.storageKey));
    expect(stored.length).toBe(saved.mediaMetadata.sizeBytes);
    expect(result.id).toBe('ev-1');
    expect(result.scanState).toBe('clean');
    expect(scanner.scan).toHaveBeenCalledWith(
      expect.any(Buffer),
      'photo.png',
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rejects files larger than the configured limit', async () => {
    await expect(
      service.upload('user-1', 'report-1', {
        fileName: 'big.png',
        mimeType: 'image/png',
        data: Buffer.alloc(2048).toString('base64'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(scanner.scan).not.toHaveBeenCalled();
  });

  it('rejects contents that do not match the declared type', async () => {
    await expect(
      service.upload('user-1', 'report-1', {
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        data: PNG_BASE64,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(scanner.scan).not.toHaveBeenCalled();
  });

  it('quarantines infected evidence without storing the file', async () => {
    scanner.scan.mockResolvedValue({
      state: 'infected',
      engine: 'clamav',
      scannedAt: scannedAt(),
      signature: 'Eicar-Test-Signature',
    });

    const result = await service.upload('user-1', 'report-1', {
      fileName: 'photo.png',
      mimeType: 'image/png',
      data: PNG_BASE64,
    });

    const saved = evidenceRepo.save.mock.calls[0][0];
    expect(saved.scanState).toBe('infected');
    expect(saved.scanEngine).toBe('clamav');
    expect(saved.scanSignature).toBe('Eicar-Test-Signature');
    expect(result.scanState).toBe('infected');
    await expect(readFile(join(storageDir, saved.storageKey))).rejects.toThrow();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'evidence.scan.infected',
        targetId: 'ev-1',
        source: 'scanner',
        metadata: expect.objectContaining({
          signature: 'Eicar-Test-Signature',
        }),
      }),
    );
  });

  it('quarantines evidence when the scanner errors', async () => {
    scanner.scan.mockResolvedValue({
      state: 'error',
      engine: 'clamav',
      scannedAt: scannedAt(),
    });

    const result = await service.upload('user-1', 'report-1', {
      fileName: 'photo.png',
      mimeType: 'image/png',
      data: PNG_BASE64,
    });

    const saved = evidenceRepo.save.mock.calls[0][0];
    expect(saved.scanState).toBe('error');
    expect(result.scanState).toBe('error');
    await expect(readFile(join(storageDir, saved.storageKey))).rejects.toThrow();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'evidence.scan.error',
        targetId: 'ev-1',
      }),
    );
  });

  it('hides quarantined evidence from residents and flags it for moderators', async () => {
    evidenceRepo.find.mockResolvedValue([
      makeAsset(),
      makeAsset({
        id: 'ev-2',
        scanState: 'infected',
        scanSignature: 'Eicar-Test-Signature',
      }),
      makeAsset({ id: 'ev-3', scanState: 'error' }),
    ]);

    const reporter = await service.list('user-1', 'report-1');
    expect(reporter.map((asset) => asset.id)).toEqual(['ev-1']);

    const moderator = await service.list('mod-1', 'report-1');
    expect(moderator.map((asset) => asset.id)).toEqual([
      'ev-1',
      'ev-2',
      'ev-3',
    ]);
    expect(moderator[1].scanState).toBe('infected');
    expect(moderator[2].scanState).toBe('error');
  });

  it('hides approved quarantined evidence from unrelated residents', async () => {
    evidenceRepo.find.mockResolvedValue([
      makeAsset({ moderationState: 'approved', scanState: 'infected' }),
    ]);

    await expect(service.list('user-9', 'report-1')).resolves.toEqual([]);
  });

  it('hides pending evidence from unrelated users', async () => {
    const visibleToReporter = await service.list('user-1', 'report-1');
    const visibleToOther = await service.list('user-9', 'report-1');

    expect(visibleToReporter).toHaveLength(1);
    expect(visibleToOther).toHaveLength(0);
  });

  it('only lets moderators review evidence', async () => {
    await expect(
      service.moderate('user-1', 'ev-1', { moderationState: 'approved' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const result = await service.moderate('mod-1', 'ev-1', {
      moderationState: 'approved',
      reason: 'clear image',
    });

    expect(result.moderationState).toBe('approved');
    expect(evidenceRepo.save.mock.calls[0][0].mediaMetadata.moderation.reason).toBe(
      'clear image',
    );
  });

  it('serves pending evidence to its reporter only', async () => {
    const uploaded = await service.upload('user-1', 'report-1', {
      fileName: 'photo.png',
      mimeType: 'image/png',
      data: PNG_BASE64,
    });
    evidenceRepo.findOneBy.mockResolvedValue({
      ...evidenceRepo.save.mock.calls[0][0],
      id: uploaded.id,
    });

    await expect(service.readFile('user-9', 'ev-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const file = await service.readFile('user-1', 'ev-1');
    expect(file.mimeType).toBe('image/png');
    expect(file.buffer.length).toBeGreaterThan(0);
  });

  it('refuses to serve quarantined files to residents and moderators', async () => {
    for (const scanState of ['infected', 'error']) {
      evidenceRepo.findOneBy.mockResolvedValue(makeAsset({ scanState }));

      await expect(
        service.readFile('user-1', 'ev-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.readFile('mod-1', 'ev-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });
});
