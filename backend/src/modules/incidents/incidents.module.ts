import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Incident } from './entities/incident.entity.js';
import { IncidentReportLink } from './entities/incident-report-link.entity.js';
import { Confirmation } from './entities/confirmation.entity.js';
import { Report } from '../reports/entities/report.entity.js';
import { IncidentsService } from './incidents.service.js';
import { IncidentsController } from './incidents.controller.js';
import { IdentityModule } from '../identity/identity.module.js';

@Module({
  imports: [
    IdentityModule,
    TypeOrmModule.forFeature([
      Incident,
      IncidentReportLink,
      Confirmation,
      Report,
    ]),
  ],
  controllers: [IncidentsController],
  providers: [IncidentsService],
  exports: [IncidentsService],
})
export class IncidentsModule {}
