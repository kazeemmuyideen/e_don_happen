import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './entities/audit-log.entity.js';
import { Report } from '../reports/entities/report.entity.js';
import { NotificationDelivery } from '../notifications/entities/notification-delivery.entity.js';
import { Incident } from '../incidents/entities/incident.entity.js';
import { SOSRequest } from '../sos/entities/sos-request.entity.js';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsController } from './analytics.controller.js';
import { IdentityModule } from '../identity/identity.module.js';

@Module({
  imports: [
    IdentityModule,
    TypeOrmModule.forFeature([
      AuditLog,
      Report,
      NotificationDelivery,
      Incident,
      SOSRequest,
    ]),
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
