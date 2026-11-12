import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IncidentsService } from './incidents.service.js';
import { Incident } from './entities/incident.entity.js';
import { IncidentReportLink } from './entities/incident-report-link.entity.js';
import { Report } from '../reports/entities/report.entity.js';

describe('IncidentsService', () => {
  let service: IncidentsService;
  let incidentRepo: any;
  let linkRepo: any;
  let manager: any;

  const makeIncident = () => ({
    id: 'incident-1',
    canonicalCategory: 'flooding',
    summary: 'Main road flooded',
    canonicalLocation: { type: 'Point', coordinates: [3.4, 6.5] },
    severity: 'High',
    status: 'Open',
    verificationState: 'Unverified',
    firstSeenAt: new Date(),
    lastUpdatedAt: new Date(),
    reportLinks: [
      {
        reportId: 'r1',
        linkType: 'corroborates',
        linkedBy: 'mod-1',
        linkedAt: new Date(),
      },
    ],
  });

  beforeEach(async () => {
    manager = {
      create: vi.fn((_entity, value) => ({ ...value })),
      save: vi.fn(async (entity, value) => {
        if (entity === Incident) return { ...value, id: 'incident-1' };
        return value;
      }),
      find: vi.fn(async (entity) =>
        entity === Report
          ? [{ id: 'r1' }, { id: 'r2' }]
          : [],
      ),
    };
    incidentRepo = {
      findOne: vi.fn().mockImplementation(async () => makeIncident()),
      findAndCount: vi.fn().mockImplementation(async () => [
        [makeIncident()],
        1,
      ]),
      save: vi.fn(async (value) => value),
    };
    linkRepo = { delete: vi.fn() };
    const db = { transaction: vi.fn(async (cb) => cb(manager)) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IncidentsService,
        { provide: getRepositoryToken(Incident), useValue: incidentRepo },
        {
          provide: getRepositoryToken(IncidentReportLink),
          useValue: linkRepo,
        },
        { provide: getRepositoryToken(Report), useValue: {} },
        { provide: DataSource, useValue: db },
      ],
    }).compile();

    service = module.get(IncidentsService);
  });

  afterEach(() => vi.clearAllMocks());

  it('creates an incident and links the supplied reports', async () => {
    const result = await service.create('mod-1', {
      canonicalCategory: 'flooding',
      summary: 'Main road flooded',
      latitude: 6.5,
      longitude: 3.4,
      severity: 'High',
      reportIds: ['r1', 'r2'],
    });

    const linkSaves = manager.save.mock.calls.filter(
      ([entity]) => entity === IncidentReportLink,
    );
    expect(linkSaves).toHaveLength(1);
    expect(linkSaves[0][1]).toHaveLength(2);
    expect(linkSaves[0][1][0].linkedBy).toBe('mod-1');
    expect(result.id).toBe('incident-1');
    expect(result.reportLinks).toHaveLength(1);
  });

  it('rejects linking unknown reports', async () => {
    await expect(
      service.linkReports('mod-1', 'incident-1', {
        reportIds: ['r1', 'missing'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates the verification state', async () => {
    await service.verify('mod-1', 'incident-1', {
      verificationState: 'Verified',
      reason: 'confirmed by three residents',
    });

    expect(incidentRepo.save).toHaveBeenCalled();
    expect(incidentRepo.save.mock.calls[0][0].verificationState).toBe(
      'Verified',
    );
  });

  it('throws when unlinking a report that is not linked', async () => {
    linkRepo.delete.mockResolvedValue({ affected: 0 });

    await expect(
      service.unlinkReport('mod-1', 'incident-1', 'r9'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists incidents with pagination metadata', async () => {
    const result = await service.list({ limit: 10, offset: 0 });

    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe('incident-1');
  });
});
