import { EntityManager } from 'typeorm';
import { Report } from '../reports/entities/report.entity.js';
import { NotificationDelivery } from './entities/notification-delivery.entity.js';
import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { NotificationsRepository } from './repositories/notifications.repository.js';
import {
  CreateNotificationSubscriptionDto,
  QuietHoursDto,
} from './dto/create-notification-subscription.dto.js';
import { UpdateNotificationSubscriptionDto } from './dto/update-notification-subscription.dto.js';
import {
  DeliveryChannel,
  DeliveryState,
  NotificationDeliveryFilterDto,
} from './dto/notification-delivery.dto.js';
import { NotificationSubscriptionResponseDto } from './dto/notification-subscription-response.dto.js';

export interface EnqueueNotificationParams {
  incidentIdOrSosId: string;
  category: string;
  latitude: number;
  longitude: number;
  priority: 'low' | 'normal' | 'high' | 'critical';
  title: string;
  body: string;
  data?: Record<string, any>;
  channels?: DeliveryChannel[];
  cooldownMinutes?: number;
}

export interface DeliveryResult {
  deliveryId: string;
  channel: DeliveryChannel;
  recipientId: string;
  status: 'enqueued' | 'skipped_duplicate' | 'skipped_no_subscription';
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly DEFAULT_COOLDOWN_MINUTES = 30;
  private readonly DEFAULT_CHANNELS: DeliveryChannel[] = [DeliveryChannel.PUSH];

  constructor(
    private readonly notificationsRepository: NotificationsRepository,
  ) {}

  async notifyReport(report: Report, manager: EntityManager): Promise<void> {
    const [longitude, latitude] = report.coordinatesOrArea.coordinates;
    const matches =
      await this.notificationsRepository.findMatchingSubscriptions(
        report.category,
        latitude,
        longitude,
        'normal',
      );
    for (const subscription of matches) {
      if (subscription.userId === report.reporterId) continue;
      await manager.save(
        NotificationDelivery,
        manager.create(NotificationDelivery, {
          recipientId: subscription.userId,
          incidentIdOrSosId: report.id,
          channel: 'in_app',
          provider: 'local-inbox',
          pushState: 'queued',
          attempt: 1,
          deliveryState: 'delivered',
          timestamps: { deliveredAt: new Date() },
          payload: {
            title: `${report.category} | ${report.metadata?.areaName || 'Nearby'}`,
            body: report.description,
            reportId: report.id,
          },
        }),
      );
    }
  }

  // Subscription management
  async createSubscription(
    userId: string,
    dto: CreateNotificationSubscriptionDto,
  ): Promise<NotificationSubscriptionResponseDto> {
    this.assertQuietHours(dto.quietHours);
    const { latitude, longitude } = this.resolveCoordinates(
      dto.latitude,
      dto.longitude,
    );
    const subscription = await this.notificationsRepository.upsertSubscription({
      userId,
      category: dto.category,
      areaOrRadius: dto.areaOrRadius,
      latitude,
      longitude,
      priorityThreshold: dto.priorityThreshold ?? 'normal',
      quietHours: dto.quietHours,
    });
    return new NotificationSubscriptionResponseDto(subscription);
  }

  async getSubscriptions(
    userId: string,
  ): Promise<NotificationSubscriptionResponseDto[]> {
    const subscriptions =
      await this.notificationsRepository.findSubscriptionsByUser(userId);
    return subscriptions.map((s) => new NotificationSubscriptionResponseDto(s));
  }

  async getSubscription(
    userId: string,
    category: string,
  ): Promise<NotificationSubscriptionResponseDto | null> {
    const subscription = await this.notificationsRepository.findSubscription(
      userId,
      category,
    );
    return subscription
      ? new NotificationSubscriptionResponseDto(subscription)
      : null;
  }

  async updateSubscription(
    userId: string,
    category: string,
    dto: UpdateNotificationSubscriptionDto,
  ): Promise<NotificationSubscriptionResponseDto | null> {
    const existing = await this.notificationsRepository.findSubscription(
      userId,
      category,
    );
    if (!existing) return null;

    this.assertQuietHours(dto.quietHours);
    const { latitude, longitude } = this.resolveCoordinates(
      dto.latitude ?? existing.latitude,
      dto.longitude ?? existing.longitude,
    );

    const updated = await this.notificationsRepository.upsertSubscription({
      ...existing,
      ...dto,
      userId,
      category,
      latitude,
      longitude,
    });
    return new NotificationSubscriptionResponseDto(updated);
  }

  async deleteSubscription(userId: string, category: string): Promise<void> {
    await this.notificationsRepository.deleteSubscription(userId, category);
  }

  // Notification enqueueing with deduplication
  async enqueueNotification(
    params: EnqueueNotificationParams,
  ): Promise<DeliveryResult[]> {
    const {
      incidentIdOrSosId,
      category,
      latitude,
      longitude,
      priority,
      title,
      body,
      data,
      channels = this.DEFAULT_CHANNELS,
      cooldownMinutes = this.DEFAULT_COOLDOWN_MINUTES,
    } = params;

    const subscriptions =
      await this.notificationsRepository.findMatchingSubscriptions(
        category,
        latitude,
        longitude,
        priority,
      );

    if (subscriptions.length === 0) {
      this.logger.debug(
        `No matching subscriptions for incident ${incidentIdOrSosId} category ${category}`,
      );
      return [];
    }

    const results: DeliveryResult[] = [];

    for (const subscription of subscriptions) {
      for (const channel of channels) {
        // Check deduplication: has this user received a notification for this incident via this channel recently?
        const recentCount =
          await this.notificationsRepository.countRecentDeliveries(
            subscription.userId,
            incidentIdOrSosId,
            channel,
            cooldownMinutes,
          );

        if (recentCount > 0) {
          this.logger.debug(
            `Skipping duplicate notification for user ${subscription.userId}, incident ${incidentIdOrSosId}, channel ${channel}`,
          );
          results.push({
            deliveryId: '',
            channel,
            recipientId: subscription.userId,
            status: 'skipped_duplicate',
          });
          continue;
        }

        // Create delivery record
        const delivery = await this.notificationsRepository.createDelivery({
          incidentIdOrSosId,
          recipientId: subscription.userId,
          channel,
          provider: this.getProviderForChannel(channel),
          attempt: 1,
          deliveryState: DeliveryState.QUEUED,
          timestamps: { enqueuedAt: new Date() },
          costMetadata: {},
          payload: { title, body, ...data },
        });

        results.push({
          deliveryId: delivery.id,
          channel,
          recipientId: subscription.userId,
          status: 'enqueued',
        });

        this.logger.debug(
          `Enqueued notification ${delivery.id} for user ${subscription.userId} via ${channel}`,
        );
      }
    }

    return results;
  }

  // Delivery processing
  async getPendingDeliveries(limit = 100): Promise<NotificationDelivery[]> {
    return this.notificationsRepository.findPendingDeliveries(limit);
  }

  async markDeliverySent(
    deliveryId: string,
    providerResponse?: any,
  ): Promise<NotificationDelivery | null> {
    const updates: Partial<NotificationDelivery> = {
      deliveryState: DeliveryState.SENT,
      timestamps: { sentAt: new Date(), ...providerResponse },
    };
    if (providerResponse?.cost) {
      updates.costMetadata = {
        ...updates.costMetadata,
        ...providerResponse.cost,
      };
    }
    return this.notificationsRepository.updateDelivery(deliveryId, updates);
  }

  async markDeliveryDelivered(
    deliveryId: string,
    providerResponse?: any,
  ): Promise<NotificationDelivery | null> {
    return this.notificationsRepository.updateDelivery(deliveryId, {
      deliveryState: DeliveryState.DELIVERED,
      timestamps: { deliveredAt: new Date(), ...providerResponse },
    });
  }

  async markDeliveryFailed(
    deliveryId: string,
    error: string,
    willRetry: boolean,
  ): Promise<NotificationDelivery | null> {
    const delivery =
      await this.notificationsRepository.findDelivery(deliveryId);
    if (!delivery) return null;

    const nextAttempt = willRetry ? delivery.attempt + 1 : delivery.attempt;
    const nextState = willRetry ? DeliveryState.QUEUED : DeliveryState.FAILED;

    return this.notificationsRepository.updateDelivery(deliveryId, {
      attempt: nextAttempt,
      deliveryState: nextState,
      timestamps: { failedAt: new Date(), error, ...delivery.timestamps },
    });
  }

  async markDeliveryAcknowledged(
    deliveryId: string,
  ): Promise<NotificationDelivery | null> {
    const delivery =
      await this.notificationsRepository.findDelivery(deliveryId);
    if (!delivery) return null;
    return this.notificationsRepository.updateDelivery(deliveryId, {
      deliveryState: DeliveryState.ACKNOWLEDGED,
      timestamps: { ...delivery.timestamps, acknowledgedAt: new Date() },
    });
  }

  async retryFailedDeliveries(maxAttempts = 3): Promise<number> {
    const failedDeliveries =
      await this.notificationsRepository.findFailedDeliveries();

    let retried = 0;
    for (const delivery of failedDeliveries) {
      if (delivery.attempt < maxAttempts) {
        await this.notificationsRepository.updateDelivery(delivery.id, {
          deliveryState: DeliveryState.QUEUED,
          attempt: delivery.attempt + 1,
        });
        retried++;
      }
    }
    return retried;
  }

  // Query methods
  async getDelivery(deliveryId: string): Promise<NotificationDelivery | null> {
    return this.notificationsRepository.findDelivery(deliveryId);
  }

  async getDeliveriesByIncident(
    incidentId: string,
  ): Promise<NotificationDelivery[]> {
    return this.notificationsRepository.findDeliveriesByIncident(incidentId);
  }

  async getDeliveriesByRecipient(
    recipientId: string,
  ): Promise<NotificationDelivery[]> {
    return this.notificationsRepository.findDeliveriesByRecipient(recipientId);
  }

  async filterDeliveries(
    filters: NotificationDeliveryFilterDto,
  ): Promise<{ data: NotificationDelivery[]; total: number }> {
    return this.notificationsRepository.filterDeliveries(filters);
  }

  async getDeliveryStats(since?: Date): Promise<Record<string, number>> {
    return this.notificationsRepository.getDeliveryStats({ since });
  }

  private getProviderForChannel(channel: DeliveryChannel): string {
    const providers: Record<DeliveryChannel, string> = {
      [DeliveryChannel.PUSH]: 'fcm',
      [DeliveryChannel.SMS]: 'twilio',
      [DeliveryChannel.EMAIL]: 'sendgrid',
      [DeliveryChannel.VOICE]: 'twilio',
      [DeliveryChannel.USSD]: 'africas_talking',
    };
    return providers[channel] ?? 'unknown';
  }

  private resolveCoordinates(latitude?: number, longitude?: number) {
    if ((latitude === undefined) !== (longitude === undefined)) {
      throw new BadRequestException(
        'Latitude and longitude must be supplied together.',
      );
    }
    return {
      latitude: latitude ?? 6.5244,
      longitude: longitude ?? 3.3792,
    };
  }

  private assertQuietHours(quietHours?: QuietHoursDto) {
    if (quietHours && !NotificationsService.validateQuietHours(quietHours)) {
      throw new BadRequestException(
        'Quiet hours must use HH:MM times and valid weekdays.',
      );
    }
  }

  // Helper to validate quiet hours format
  static validateQuietHours(quietHours: QuietHoursDto): boolean {
    if (!quietHours) return true;
    if (!quietHours.start || !quietHours.end) return false;
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    const days = [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ];
    if (quietHours.days?.some((day) => !days.includes(day))) return false;
    return timeRegex.test(quietHours.start) && timeRegex.test(quietHours.end);
  }
}
