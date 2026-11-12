import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Report } from '../entities/report.entity.js';
import { Confirmation } from '../../incidents/entities/confirmation.entity.js';
import { ReportsRepository } from '../repositories/reports.repository.js';
import {
  CreateReportDto,
  UpdateReportDto,
  ConfirmationDto,
} from '../dto/create-report.dto.js';
import {
  PUBLIC_REPORT_STATES,
  ReportState,
  VOTABLE_REPORT_STATES,
} from '../interfaces/report.interface.js';
import type { FeedQueryParams } from '../interfaces/report.interface.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import {
  PostcodeAreaDetails,
  PostcodeService,
} from '../../postcode/postcode.service.js';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Report) private readonly reports: Repository<Report>,
    private readonly repository: ReportsRepository,
    private readonly db: DataSource,
    private readonly notifications: NotificationsService,
    private readonly postcode: PostcodeService,
  ) {}

  async createReport(userId: string, dto: CreateReportDto) {
    if (dto.description.trim().length < 10)
      throw new BadRequestException(
        'Description needs at least 10 non-padding characters.',
      );
    if (dto.evidenceReferences?.length)
      this.assertEvidenceReferences(dto.evidenceReferences);
    const observedAt = dto.observedAt ? new Date(dto.observedAt) : new Date();
    if (observedAt.getTime() > Date.now() + 60000)
      throw new BadRequestException('Observed time cannot be in the future.');
    const postcode = dto.location.postcode
      ? await this.postcode.validateForReport(dto.location.postcode)
      : null;
    const report = await this.db.transaction(async (manager) => {
      const report = await manager.save(
        Report,
        manager.create(Report, {
          reporterId: userId,
          category: dto.category,
          description: dto.description.trim(),
          observedAt,
          coordinatesOrArea: {
            type: 'Point',
            coordinates: [dto.location.longitude, dto.location.latitude],
          },
          locationPrecision: 'approximate',
          evidenceReferences: [],
          metadata: this.buildMetadata(dto.location, postcode),
          state: ReportState.UNVERIFIED,
        }),
      );
      await this.notifications.notifyReport(report, manager);
      return report;
    });
    return this.getReport(report.id);
  }

  async getReport(id: string) {
    const report = await this.repository.findById(id);
    if (
      !report ||
      !PUBLIC_REPORT_STATES.includes(report.state as ReportState)
    )
      throw new NotFoundException('Report not found');
    return this.present(report);
  }

  async getFeed(params: FeedQueryParams) {
    if ((params.latitude === undefined) !== (params.longitude === undefined))
      throw new BadRequestException(
        'Latitude and longitude must be supplied together.',
      );
    const reports = await this.repository.findForFeed(params);
    const counts = await this.repository.countVerifiedByReporterIds([
      ...new Set(reports.map((report) => report.reporterId)),
    ]);
    return Promise.all(
      reports.map((report) =>
        this.present(report, counts.get(report.reporterId) ?? 0),
      ),
    );
  }

  private async present(report: Report, verifiedReportCount?: number) {
    const verifiedReports =
      verifiedReportCount ??
      (await this.reports.count({
        where: { reporterId: report.reporterId, state: ReportState.VERIFIED },
      }));
    return {
      id: report.id,
      category: report.category,
      description: report.description,
      reporterId: report.reporterId,
      observedAt: report.observedAt,
      submittedAt: report.submittedAt,
      areaName: report.metadata?.areaName || 'Lagos',
      postcode: report.metadata?.postcode || undefined,
      locationPrecision: report.locationPrecision,
      coordinates: {
        type: 'Point',
        coordinates: report.coordinatesOrArea.coordinates.map(
          (n) => Math.round(n * 100) / 100,
        ),
      },
      state: report.state,
      confirmationsCount: report.confirmationsCount,
      disputesCount: report.disputesCount,
      reporter: {
        id: report.reporterId,
        displayName: report.reporter?.displayName || 'Resident',
        verifiedReports,
        trustedContributor: verifiedReports >= 10,
      },
    };
  }

  private assertEvidenceReferences(references: string[]) {
    if (references.length > 10)
      throw new BadRequestException(
        'A report can reference at most 10 evidence items.',
      );
    for (const reference of references) {
      const trimmed = reference.trim();
      if (!trimmed || trimmed.length > 500)
        throw new BadRequestException(
          'Evidence references must be 1-500 characters.',
        );
    }
  }

  private buildMetadata(
    location: { areaName?: string },
    postcode: {
      postcode: string;
      display: string;
      source: string;
      area: PostcodeAreaDetails | null;
    } | null,
  ) {
    const area =
      postcode?.area?.localityName ||
      postcode?.area?.lgaName ||
      location.areaName ||
      'Selected area';
    return {
      areaName: area,
      ...(postcode && {
        postcode: postcode.postcode,
        postcodeDisplay: postcode.display,
        postcodeSource: postcode.source,
        ...(postcode.area?.stateName && {
          stateName: postcode.area.stateName,
        }),
        ...(postcode.area?.lgaName && { lgaName: postcode.area.lgaName }),
        ...(postcode.area?.localityName && {
          localityName: postcode.area.localityName,
        }),
      }),
    };
  }

  async updateReport(userId: string, id: string, dto: UpdateReportDto) {
    const report = await this.reports.findOneBy({ id });
    if (!report) throw new NotFoundException('Report not found');
    if (report.reporterId !== userId)
      throw new ForbiddenException('You can only update your own reports');
    if (report.state !== ReportState.UNVERIFIED)
      throw new BadRequestException(
        'Reviewed reports cannot be edited. Submit an update as a new report.',
      );
    if (dto.description !== undefined && dto.description.trim().length < 10)
      throw new BadRequestException(
        'Description needs at least 10 non-padding characters.',
      );
    if (dto.evidenceReferences?.length)
      this.assertEvidenceReferences(dto.evidenceReferences);
    if (dto.description !== undefined)
      report.description = dto.description.trim();
    if (dto.category) report.category = dto.category;
    if (dto.location) {
      const postcode = dto.location.postcode
        ? await this.postcode.validateForReport(dto.location.postcode)
        : null;
      report.coordinatesOrArea = {
        type: 'Point',
        coordinates: [dto.location.longitude, dto.location.latitude],
      };
      report.metadata = {
        ...report.metadata,
        ...this.buildMetadata(dto.location, postcode),
      };
    }
    if (dto.observedAt) {
      if (new Date(dto.observedAt).getTime() > Date.now() + 60000)
        throw new BadRequestException('Observed time cannot be in the future.');
      report.observedAt = new Date(dto.observedAt);
    }
    await this.reports.save(report);
    return this.getReport(id);
  }

  async addConfirmation(userId: string, dto: ConfirmationDto) {
    if (dto.action === 'confirm' && dto.firsthand !== true)
      throw new BadRequestException(
        'Confirm only what you witnessed firsthand.',
      );
    await this.db.transaction(async (manager) => {
      const report = await manager.findOne(Report, {
        where: { id: dto.reportId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!report) throw new NotFoundException('Report not found');
      if (report.reporterId === userId)
        throw new ForbiddenException('You cannot vote on your own report.');
      if (
        !VOTABLE_REPORT_STATES.includes(report.state as ReportState)
      )
        throw new BadRequestException('This report is closed for voting.');
      const key = { userId, reportIdOrIncidentId: dto.reportId };
      const existing = await manager.findOneBy(Confirmation, key);
      if (existing) {
        existing.confirmationOrDispute = dto.action;
        existing.firsthandFlag = dto.firsthand || false;
        await manager.save(existing);
      } else {
        await manager.save(
          Confirmation,
          manager.create(Confirmation, {
            ...key,
            confirmationOrDispute: dto.action,
            firsthandFlag: dto.firsthand || false,
          }),
        );
      }
      report.confirmationsCount = await manager.countBy(Confirmation, {
        reportIdOrIncidentId: report.id,
        confirmationOrDispute: 'confirm',
      });
      report.disputesCount = await manager.countBy(Confirmation, {
        reportIdOrIncidentId: report.id,
        confirmationOrDispute: 'dispute',
      });
      // Votes indicate community confidence; only moderators can verify a report.
      if (report.state !== ReportState.VERIFIED) {
        report.state =
          report.disputesCount > 0
            ? ReportState.DISPUTED
            : report.confirmationsCount >= 2
              ? ReportState.CORROBORATED
              : ReportState.UNVERIFIED;
      }
      await manager.save(report);
    });
    return this.getReport(dto.reportId);
  }

  async deleteReport(userId: string, id: string) {
    const report = await this.reports.findOneBy({ id });
    if (!report) throw new NotFoundException('Report not found');
    if (report.reporterId !== userId)
      throw new ForbiddenException('You can only delete your own reports');
    await this.reports.update(id, { state: ReportState.REMOVED });
  }
}
