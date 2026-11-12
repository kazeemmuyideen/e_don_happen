import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Incident } from './entities/incident.entity.js';
import { IncidentReportLink } from './entities/incident-report-link.entity.js';
import { Report } from '../reports/entities/report.entity.js';
import {
  CreateIncidentDto,
  IncidentQueryDto,
  LinkReportsDto,
  UpdateIncidentDto,
  VerifyIncidentDto,
} from './dto/incident.dto.js';

@Injectable()
export class IncidentsService {
  constructor(
    @InjectRepository(Incident)
    private readonly incidentRepo: Repository<Incident>,
    @InjectRepository(IncidentReportLink)
    private readonly linkRepo: Repository<IncidentReportLink>,
    @InjectRepository(Report)
    private readonly reportRepo: Repository<Report>,
    private readonly db: DataSource,
  ) {}

  async create(actorId: string, dto: CreateIncidentDto) {
    const incident = await this.db.transaction(async (manager) => {
      const saved = await manager.save(
        Incident,
        manager.create(Incident, {
          canonicalCategory: dto.canonicalCategory,
          summary: dto.summary,
          canonicalLocation: {
            type: 'Point',
            coordinates: [dto.longitude, dto.latitude],
          } as any,
          severity: dto.severity ?? 'Medium',
        }),
      );
      if (dto.reportIds?.length) {
        await this.linkReportsWithin(manager, saved.id, dto.reportIds, actorId);
      }
      return saved;
    });
    return this.get(incident.id);
  }

  async list(query: IncidentQueryDto) {
    const where: Record<string, unknown> = {};
    if (query.category) where.canonicalCategory = query.category;
    if (query.status) where.status = query.status;
    const [items, total] = await this.incidentRepo.findAndCount({
      where,
      relations: ['reportLinks'],
      order: { lastUpdatedAt: 'DESC' },
      take: query.limit ?? 20,
      skip: query.offset ?? 0,
    });
    return {
      total,
      items: items.map((incident) => this.present(incident)),
    };
  }

  async get(id: string) {
    const incident = await this.incidentRepo.findOne({
      where: { id },
      relations: ['reportLinks'],
    });
    if (!incident) throw new NotFoundException('Incident not found');
    return this.present(incident);
  }

  async update(actorId: string, id: string, dto: UpdateIncidentDto) {
    const incident = await this.findOrFail(id);
    if (dto.summary !== undefined) incident.summary = dto.summary;
    if (dto.severity !== undefined) incident.severity = dto.severity;
    if (dto.status !== undefined) incident.status = dto.status;
    await this.incidentRepo.save(incident);
    return this.get(id);
  }

  async verify(actorId: string, id: string, dto: VerifyIncidentDto) {
    const incident = await this.findOrFail(id);
    incident.verificationState = dto.verificationState;
    await this.incidentRepo.save(incident);
    return this.get(id);
  }

  async linkReports(actorId: string, id: string, dto: LinkReportsDto) {
    await this.findOrFail(id);
    await this.db.transaction((manager) =>
      this.linkReportsWithin(
        manager,
        id,
        dto.reportIds,
        actorId,
        dto.linkType ?? 'corroborates',
      ),
    );
    return this.get(id);
  }

  async unlinkReport(actorId: string, id: string, reportId: string) {
    await this.findOrFail(id);
    const result = await this.linkRepo.delete({ incidentId: id, reportId });
    if (!result.affected) throw new NotFoundException('Report link not found');
    return this.get(id);
  }

  private async linkReportsWithin(
    manager: DataSource['manager'],
    incidentId: string,
    reportIds: string[],
    actorId: string,
    linkType = 'corroborates',
  ) {
    const uniqueIds = [...new Set(reportIds)];
    const reports = await manager.find(Report, {
      where: { id: In(uniqueIds) },
      select: { id: true },
    });
    const found = new Set(reports.map((report) => report.id));
    const missing = uniqueIds.filter((reportId) => !found.has(reportId));
    if (missing.length)
      throw new BadRequestException(
        `Unknown report ids: ${missing.join(', ')}`,
      );
    const existing = await manager.find(IncidentReportLink, {
      where: { incidentId },
      select: { reportId: true },
    });
    const alreadyLinked = new Set(existing.map((link) => link.reportId));
    const links = uniqueIds
      .filter((reportId) => !alreadyLinked.has(reportId))
      .map((reportId) =>
        manager.create(IncidentReportLink, {
          incidentId,
          reportId,
          linkType,
          linkedBy: actorId,
        }),
      );
    if (links.length) await manager.save(IncidentReportLink, links);
  }

  private async findOrFail(id: string) {
    const incident = await this.incidentRepo.findOne({ where: { id } });
    if (!incident) throw new NotFoundException('Incident not found');
    return incident;
  }

  private present(incident: Incident) {
    const coordinates = (incident.canonicalLocation as any)?.coordinates;
    return {
      id: incident.id,
      canonicalCategory: incident.canonicalCategory,
      summary: incident.summary,
      canonicalLocation:
        Array.isArray(coordinates) && coordinates.length === 2
          ? {
              type: 'Point',
              coordinates: [
                Math.round(coordinates[0] * 100) / 100,
                Math.round(coordinates[1] * 100) / 100,
              ],
            }
          : incident.canonicalLocation,
      severity: incident.severity,
      status: incident.status,
      verificationState: incident.verificationState,
      firstSeenAt: incident.firstSeenAt,
      lastUpdatedAt: incident.lastUpdatedAt,
      reportLinks: (incident.reportLinks ?? []).map(
        (link: IncidentReportLink) => ({
          reportId: link.reportId,
          linkType: link.linkType,
          linkedBy: link.linkedBy,
          linkedAt: link.linkedAt,
        }),
      ),
    };
  }
}
