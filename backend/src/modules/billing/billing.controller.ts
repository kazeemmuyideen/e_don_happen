import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
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
  CreateBillingSubscriptionDto,
  UpdateBillingSubscriptionDto,
} from './dto/billing.dto.js';

@ApiTags('Billing')
@ApiBearerAuth()
@Controller('billing/subscriptions')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.COMMUNITY_ADMIN, UserRole.MODERATOR, UserRole.SUPER_ADMIN)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post()
  @ApiOperation({ summary: 'Create a community subscription' })
  create(
    @CurrentUserId() userId: string,
    @Body() dto: CreateBillingSubscriptionDto,
  ) {
    return this.billingService.create(userId, dto);
  }

  @Get('community/:communityId')
  @ApiOperation({ summary: 'List subscriptions for a community' })
  listByCommunity(
    @Param('communityId') communityId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.billingService.listByCommunity(userId, communityId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a subscription' })
  get(@Param('id') id: string, @CurrentUserId() userId: string) {
    return this.billingService.get(userId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update plan or status' })
  update(
    @Param('id') id: string,
    @CurrentUserId() userId: string,
    @Body() dto: UpdateBillingSubscriptionDto,
  ) {
    return this.billingService.update(userId, id, dto);
  }

  @Put(':id/cancel')
  @ApiOperation({ summary: 'Cancel a subscription' })
  cancel(@Param('id') id: string, @CurrentUserId() userId: string) {
    return this.billingService.cancel(userId, id);
  }
}
