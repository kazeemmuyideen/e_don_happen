import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseModule } from './database/database.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { IncidentsModule } from './modules/incidents/incidents.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { SosModule } from './modules/sos/sos.module.js';
import { CommunityModule } from './modules/community/community.module.js';
import { ModerationModule } from './modules/moderation/moderation.module.js';
import { BillingModule } from './modules/billing/billing.module.js';
import { AnalyticsModule } from './modules/analytics/analytics.module.js';
import { PostcodeModule } from './modules/postcode/postcode.module.js';
import { RedisModule } from './redis/redis.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { RateLimitMiddleware } from './common/rate-limit.middleware.js';
import appConfig from './config/app.config.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      envFilePath: ['.env.local', '.env'],
    }),
    DatabaseModule,
    RedisModule,
    AuditModule,
    IdentityModule,
    ReportsModule,
    IncidentsModule,
    NotificationsModule,
    SosModule,
    CommunityModule,
    ModerationModule,
    BillingModule,
    AnalyticsModule,
    PostcodeModule,
  ],
  controllers: [AppController],
  providers: [AppService, RateLimitMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RateLimitMiddleware).forRoutes('{*splat}');
  }
}
