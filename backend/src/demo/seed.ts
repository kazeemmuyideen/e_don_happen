import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module.js';
import { User } from '../modules/identity/entities/user.entity.js';
import {
  UserRole,
  AccountStatus,
} from '../modules/identity/interfaces/identity.interface.js';
import { Report } from '../modules/reports/entities/report.entity.js';
import { NotificationSubscription } from '../modules/notifications/entities/notification-subscription.entity.js';
import { NotificationDelivery } from '../modules/notifications/entities/notification-delivery.entity.js';
import { ModerationAction } from '../modules/moderation/entities/moderation-action.entity.js';
import { Community } from '../modules/community/entities/community.entity.js';
import { Responder } from '../modules/community/entities/responder.entity.js';
import { SOSRequest } from '../modules/sos/entities/sos-request.entity.js';
import { SOSRecipient } from '../modules/sos/entities/sos-recipient.entity.js';
import { Incident } from '../modules/incidents/entities/incident.entity.js';
import { IncidentReportLink } from '../modules/incidents/entities/incident-report-link.entity.js';
import { Subscription } from '../modules/billing/entities/subscription.entity.js';

if (
  process.env.DEMO_MODE !== 'true' ||
  process.env.NODE_ENV === 'production' ||
  process.env.DB_NAME !== 'neighbourhood_signal_demo'
) {
  throw new Error(
    'Seeding is restricted to the local demo database with DEMO_MODE=true.',
  );
}
const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
});
try {
  const db = app.get(DataSource);
  await db.transaction(async (manager) => {
    const people = [
      {
        phone: '+2348000000001',
        displayName: 'Ada · demo resident',
        role: UserRole.RESIDENT,
      },
      {
        phone: '+2348000000002',
        displayName: 'Tunde · demo witness',
        role: UserRole.RESIDENT,
      },
      {
        phone: '+2348000000003',
        displayName: 'Zainab · demo witness',
        role: UserRole.RESIDENT,
      },
      {
        phone: '+2348000000004',
        displayName: 'Bisi · demo moderator',
        role: UserRole.MODERATOR,
      },
    ];
    const users: User[] = [];
    for (const person of people) {
      let user = await manager.findOneBy(User, { phone: person.phone });
      if (!user)
        user = await manager.save(
          User,
          manager.create(User, {
            ...person,
            accountStatus: AccountStatus.ACTIVE,
            metadata: { demo: true, lgas: ['Yaba'] },
          }),
        );
      users.push(user);
      for (const category of ['traffic', 'weather', 'utilities', 'community']) {
        if (
          !(await manager.findOneBy(NotificationSubscription, {
            userId: user.id,
            category,
          }))
        ) {
          await manager.save(
            NotificationSubscription,
            manager.create(NotificationSubscription, {
              userId: user.id,
              category,
              areaOrRadius: 5,
              latitude: 6.5158,
              longitude: 3.3711,
              priorityThreshold: 'normal',
            }),
          );
        }
      }
    }
    const samples = [
      {
        category: 'traffic',
        description:
          '[Sample] Slow-moving traffic near Yaba bus stop after the morning rain.',
        area: 'Yaba',
        lat: 6.5158,
        lon: 3.3711,
      },
      {
        category: 'weather',
        description:
          '[Sample] Standing water at the junction. Pedestrians are using the raised walkway.',
        area: 'Yaba',
        lat: 6.518,
        lon: 3.372,
      },
      {
        category: 'utilities',
        description:
          '[Sample] Electricity has been restored around the community market.',
        area: 'Surulere',
        lat: 6.5,
        lon: 3.35,
      },
    ];
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      const key = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
      if (!(await manager.existsBy(Report, { id: key }))) {
        const report = await manager.save(
          Report,
          manager.create(Report, {
            id: key,
            reporterId: users[0].id,
            category: sample.category,
            description: sample.description,
            observedAt: new Date(),
            coordinatesOrArea: {
              type: 'Point',
              coordinates: [sample.lon, sample.lat],
            },
            locationPrecision: 'approximate',
            metadata: { demo: true, areaName: sample.area },
            state: 'unverified',
          }),
        );
        for (const recipient of users.slice(1))
          await manager.save(
            NotificationDelivery,
            manager.create(NotificationDelivery, {
              recipientId: recipient.id,
              incidentIdOrSosId: report.id,
              channel: 'in_app',
              provider: 'local-inbox',
              deliveryState: 'delivered',
              payload: {
                title: `${sample.category} · ${sample.area}`,
                body: sample.description,
                reportId: report.id,
              },
              timestamps: { deliveredAt: new Date() },
            }),
          );
      }
    }
    // Nine explicitly illustrative moderator-reviewed reports put Ada one report away from the badge.
    for (let i = 0; i < 9; i++) {
      const id = `00000000-0000-4000-8001-${String(i + 1).padStart(12, '0')}`;
      if (await manager.existsBy(Report, { id })) continue;
      const report = await manager.save(
        Report,
        manager.create(Report, {
          id,
          reporterId: users[0].id,
          category: 'community',
          description: `[Sample history ${i + 1}] Community notice board updated near Yaba market. Illustrative verified contribution.`,
          observedAt: new Date(Date.now() - (i + 1) * 86400000),
          submittedAt: new Date(Date.now() - (i + 1) * 86400000),
          coordinatesOrArea: { type: 'Point', coordinates: [3.3711, 6.5158] },
          locationPrecision: 'approximate',
          metadata: { demo: true, areaName: 'Yaba' },
          state: 'verified',
        }),
      );
      await manager.save(
        ModerationAction,
        manager.create(ModerationAction, {
          actorId: users[3].id,
          targetId: report.id,
          targetType: 'report',
          action: 'approve',
          reason:
            'Illustrative seed verification for the local demonstration only.',
          metadata: {
            demo: true,
            previousState: 'unverified',
            newState: 'verified',
          },
        }),
      );
    }

    const boundary = {
      type: 'Polygon',
      coordinates: [
        [
          [3.3611, 6.5058],
          [3.3811, 6.5058],
          [3.3811, 6.5258],
          [3.3611, 6.5258],
          [3.3611, 6.5058],
        ],
      ],
    };
    const communityId = '00000000-0000-4000-8002-000000000001';
    if (!(await manager.existsBy(Community, { id: communityId }))) {
      await manager.save(
        Community,
        manager.create(Community, {
          id: communityId,
          name: 'Yaba demo community',
          boundary: boundary as any,
          adminId: users[0].id,
          status: 'active',
          plan: 'standard',
          responderCoverageConfiguration: { demo: true },
        }),
      );
    }
    if (
      !(await manager.findOneBy(Responder, {
        userId: users[2].id,
        communityId,
      }))
    ) {
      await manager.save(
        Responder,
        manager.create(Responder, {
          userId: users[2].id,
          communityId,
          qualificationsOrRoleClaims: { demo: true, role: 'community responder' },
          availabilityWindow: { demo: true, always: true },
          coverageArea: boundary as any,
          status: 'active',
        }),
      );
    }
    if (
      !(await manager.findOneBy(Subscription, {
        organisationOrCommunityId: communityId,
      }))
    ) {
      const renewalDate = new Date();
      renewalDate.setDate(renewalDate.getDate() + 30);
      await manager.save(
        Subscription,
        manager.create(Subscription, {
          id: '00000000-0000-4000-8005-000000000001',
          organisationOrCommunityId: communityId,
          plan: 'standard',
          status: 'active',
          renewalDate,
          billingReference: 'demo-record',
        }),
      );
    }

    const sosId = '00000000-0000-4000-8003-000000000001';
    if (!(await manager.existsBy(SOSRequest, { id: sosId }))) {
      await manager.save(
        SOSRequest,
        manager.create(SOSRequest, {
          id: sosId,
          requesterId: users[0].id,
          incidentType: 'medical',
          message: '[Sample] Someone needs help near the market gate.',
          locationLabel: 'Yaba market gate',
          locationSnapshot: {
            type: 'Point',
            coordinates: [3.3711, 6.5158],
          } as any,
          sharingPolicy: { scope: 'nearby_responders', demo: true },
          escalationPolicy: {
            acknowledgeWithinMinutes: 10,
            escalateAfterMinutes: 15,
            demo: true,
          },
          state: 'active',
        }),
      );
    }
    if (
      !(await manager.findOneBy(SOSRecipient, {
        sosId,
        recipientId: users[2].id,
      }))
    ) {
      await manager.save(
        SOSRecipient,
        manager.create(SOSRecipient, {
          sosId,
          recipientId: users[2].id,
          role: 'responder',
          channel: 'in_app',
          deliveryState: 'delivered',
          acknowledgementState: 'unacknowledged',
          timestamps: { enqueuedAt: new Date(), deliveredAt: new Date() },
        }),
      );
      await manager.save(
        NotificationDelivery,
        manager.create(NotificationDelivery, {
          recipientId: users[2].id,
          incidentIdOrSosId: sosId,
          channel: 'in_app',
          provider: 'local-inbox',
          deliveryState: 'delivered',
          payload: {
            title: 'SOS: medical',
            body: '[Sample] Someone needs help near the market gate.',
            sosId,
          },
          timestamps: { deliveredAt: new Date() },
        }),
      );
    }

    const incidentId = '00000000-0000-4000-8004-000000000001';
    if (!(await manager.existsBy(Incident, { id: incidentId }))) {
      await manager.save(
        Incident,
        manager.create(Incident, {
          id: incidentId,
          canonicalCategory: 'traffic',
          summary:
            '[Sample] Slow traffic around Yaba bus stop after morning rain.',
          canonicalLocation: {
            type: 'Point',
            coordinates: [3.3711, 6.5158],
          } as any,
          status: 'Open',
          verificationState: 'Verified',
          severity: 'Medium',
        }),
      );
    }
    for (const reportId of [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ]) {
      if (
        !(await manager.findOneBy(IncidentReportLink, {
          incidentId,
          reportId,
        }))
      ) {
        await manager.save(
          IncidentReportLink,
          manager.create(IncidentReportLink, {
            incidentId,
            reportId,
            linkType: 'related',
            linkedBy: users[3].id,
          }),
        );
      }
    }
  });
  console.log(
    'Demo seed complete (existing data preserved). Sign in with +2348000000001 through +2348000000004.',
  );
} finally {
  await app.close();
}
