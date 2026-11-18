import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RolesGuard } from '../identity/guards/roles.guard.js';
import { Roles } from '../identity/decorators/roles.decorator.js';
import { CurrentUserId } from '../identity/decorators/current-user-id.decorator.js';
import { UserRole } from '../identity/interfaces/identity.interface.js';
import { BillingService } from './billing.service.js';
import {
  InitializePaymentDto,
  VerifyPaymentDto,
} from './dto/billing.dto.js';

@ApiTags('Billing')
@ApiBearerAuth()
@Controller('billing/payments')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.COMMUNITY_ADMIN, UserRole.MODERATOR, UserRole.SUPER_ADMIN)
export class PaymentController {
  constructor(private readonly billingService: BillingService) {}

  @Post('checkout')
  @ApiOperation({ summary: 'Initialize a subscription payment' })
  initialize(
    @CurrentUserId() userId: string,
    @Body() dto: InitializePaymentDto,
  ) {
    return this.billingService.initializePayment(userId, dto);
  }

  @Post('verify')
  @ApiOperation({ summary: 'Verify and settle a subscription payment' })
  verify(
    @CurrentUserId() userId: string,
    @Body() dto: VerifyPaymentDto,
  ) {
    return this.billingService.verifyPayment(userId, dto);
  }

  @Get(':reference')
  @ApiOperation({ summary: 'Get a payment attempt' })
  get(
    @CurrentUserId() userId: string,
    @Param('reference') reference: string,
  ) {
    return this.billingService.getPayment(userId, reference);
  }
}
