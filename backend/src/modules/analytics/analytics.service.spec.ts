import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AnalyticsService } from './analytics.service.js';
import { Report } from '../reports/entities/report.entity.js';
import { NotificationDelivery } from '../notifications/entities/notification-delivery.entity.js';
import { Incident } from '../incidents/entities/incident.entity.js';
import { SOSRequest } from '../sos/entities/sos-request.entity.js';
import { AuditLog } from './entities/audit-log.entity.js';

function makeRepo(raw: { key: string; count: string }[] = []) {
  const qb = {
    select: vi.fn().mockReturnThis(),
    addSelect: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    getRawMany: vi.fn().mockResolvedValue(raw),
  };
  return {
    createQueryBuilder: vi.fn(() => qb),
    count: vi.fn().mockResolvedValue(4),
  };
}

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let reportRepo: any;
  let deliveryRepo: any;
  let incidentRepo: any;
  let sosRepo: any;
  let auditRepo: any;

  beforeEach(async () => {
    reportRepo = makeRepo([{ key: 'unverified', count: '3' }]);
    deliveryRepo = makeRepo([{ key: 'delivered', count: '5' }]);
    incidentRepo = makeRepo([{ key: 'Open', count: '2' }]);
    sosRepo = makeRepo([{ key: 'active', count: '1' }]);
    auditRepo = {
      findAndCount: vi.fn().mockResolvedValue([
        [
          {
            id: 'log-1',
            actorId: 'mod-1',
            action: 'report.verify',
            targetId: 'report-1',
            source: 'moderation',
            reason: 'confirmed',
            metadata: {},
            timestamp: new Date(),
            actor: { displayName: 'Mod' },
          },
        ],
        1,
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: getRepositoryToken(Report), useValue: reportRepo },
        {
          provide: getRepositoryToken(NotificationDelivery),
          useValue: deliveryRepo,
        },
        { provide: getRepositoryToken(Incident), useValue: incidentRepo },
        { provide: getRepositoryToken(SOSRequest), useValue: sosRepo },
        { provide: getRepositoryToken(AuditLog), useValue: auditRepo },
      ],
    }).compile();

    service = module.get(AnalyticsService);
  });

  afterEach(() => vi.clearAllMocks());

  it('summarises reports by state and category', async () => {
    const result = await service.reportSummary({ sinceDays: 7 });

    expect(result.total).toBe(4);
    expect(result.last24h).toBe(4);
    expect(result.byState).toEqual([{ key: 'unverified', count: 3 }]);
    expect(result.byCategory).toEqual([{ key: 'unverified', count: 3 }]);
  });

  it('summarises notification delivery', async () => {
    const result = await service.notificationSummary({ sinceDays: 30 });

    expect(result.total).toBe(4);
    expect(result.byDeliveryState).toEqual([
      { key: 'delivered', count: 5 },
    ]);
    expect(result.byChannel).toEqual([{ key: 'delivered', count: 5 }]);
    expect(result.byProvider).toEqual([{ key: 'delivered', count: 5 }]);
  });

  it('summarises incidents', async () => {
    const result = await service.incidentSummary();

    expect(result.total).toBe(4);
    expect(result.byStatus).toEqual([{ key: 'Open', count: 2 }]);
  });

  it('summarises SOS requests', async () => {
    const result = await service.sosSummary({ sinceDays: 1 });

    expect(result.total).toBe(4);
    expect(result.byState).toEqual([{ key: 'active', count: 1 }]);
  });

  it('returns paginated audit logs with actor names', async () => {
    const result = await service.auditLogs({ limit: 10, offset: 0 });

    expect(result.total).toBe(1);
    expect(result.items[0].actorName).toBe('Mod');
    expect(result.items[0].action).toBe('report.verify');
  });
});
