import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { BillingService } from './billing.service.js';

@ApiTags('Billing')
@Controller('webhooks/payments')
export class PaymentWebhookController {
  constructor(private readonly billingService: BillingService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive payment provider webhooks' })
  handle(
    @Req() request: Request & { rawBody?: Buffer },
    @Headers('x-paystack-signature') paystackSignature?: string,
    @Headers('x-payment-signature') paymentSignature?: string,
  ) {
    return this.billingService.handlePaymentWebhook(
      request.rawBody,
      paystackSignature || paymentSignature,
    );
  }
}
