import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subscription } from './entities/subscription.entity.js';
import { PaymentAttempt } from './entities/payment-attempt.entity.js';
import { PaymentEvent } from './entities/payment-event.entity.js';
import { Community } from '../community/entities/community.entity.js';
import { User } from '../identity/entities/user.entity.js';
import { BillingService } from './billing.service.js';
import { BillingController } from './billing.controller.js';
import { PaymentController } from './payment.controller.js';
import { PaymentWebhookController } from './payment-webhook.controller.js';
import { PaymentGatewayService } from './services/payment-gateway.service.js';
import { IdentityModule } from '../identity/identity.module.js';

@Module({
  imports: [
    IdentityModule,
    TypeOrmModule.forFeature([
      Subscription,
      PaymentAttempt,
      PaymentEvent,
      Community,
      User,
    ]),
  ],
  controllers: [BillingController, PaymentController, PaymentWebhookController],
  providers: [BillingService, PaymentGatewayService],
  exports: [BillingService, PaymentGatewayService],
})
export class BillingModule {}
