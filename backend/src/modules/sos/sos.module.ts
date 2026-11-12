import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SOSRequest } from './entities/sos-request.entity.js';
import { SOSRecipient } from './entities/sos-recipient.entity.js';
import { SosService } from './sos.service.js';
import { SosController } from './sos.controller.js';
import { Responder } from '../community/entities/responder.entity.js';
import { Community } from '../community/entities/community.entity.js';
import { User } from '../identity/entities/user.entity.js';
import { NotificationDelivery } from '../notifications/entities/notification-delivery.entity.js';
import { IdentityModule } from '../identity/identity.module.js';

@Module({
  imports: [
    IdentityModule,
    TypeOrmModule.forFeature([
      SOSRequest,
      SOSRecipient,
      Responder,
      Community,
      User,
      NotificationDelivery,
    ]),
  ],
  controllers: [SosController],
  providers: [SosService],
  exports: [SosService],
})
export class SosModule {}
