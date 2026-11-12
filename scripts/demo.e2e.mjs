import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomInt } from 'node:crypto';

if (
  process.env.DB_NAME !== 'neighbourhood_signal_demo' ||
  process.env.DEMO_MODE !== 'true'
)
  throw new Error('Use the local demo environment for this integration suite.');
const base = 'http://127.0.0.1:3100/api';
const db = new pg.Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
const users = [];
const createdIncidentIds = [];
const createdCommunityIds = [];
const createdSubscriptionIds = [];
const createdSosIds = [];
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const otpFile = resolve('.local/test-otps.json');
let backend;
let serverLog = '';
async function call(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}
async function login() {
  const phone = `+23481${randomInt(10000000, 99999999)}`;
  const sent = await call('/auth/send-otp', {
    method: 'POST',
    body: { phone },
  });
  assert.equal(sent.status, 200);
  assert.equal(
    sent.data.demoOtp,
    undefined,
    'Codes must not be returned to browsers',
  );
  const result = await call('/auth/verify-otp', {
    method: 'POST',
    body: {
      phone,
      otp: JSON.parse(await readFile(otpFile, 'utf8')).codes.find(
        (item) => item.phone === phone,
      ).code,
    },
  });
  assert.equal(result.status, 200);
  users.push(result.data.user.id);
  return { ...result.data, phone, token: result.data.accessToken };
}
before(async () => {
  await db.connect();
  backend = spawn(process.execPath, ['backend/dist/main.js'], {
    env: {
      ...process.env,
      PORT: '3100',
      DEMO_OTP_FILE: otpFile,
      WEB_PUSH_WORKER: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backend.stdout.on('data', (chunk) => {
    serverLog += chunk;
  });
  backend.stderr.on('data', (chunk) => {
    serverLog += chunk;
  });
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(base)).ok) return;
    } catch {}
    if (backend.exitCode !== null) throw new Error(serverLog);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Backend did not start: ${serverLog}`);
});
after(async () => {
  await writeFile('.local/api-test.log', serverLog);
  if (backend) {
    backend.kill();
    await new Promise((resolve) => {
      if (backend.exitCode !== null) resolve();
      else backend.once('exit', resolve);
    });
  }
  if (users.length) {
    await db.query(
      'DELETE FROM notification_deliveries WHERE recipient = ANY($1::uuid[]) OR incident_id_or_sos_id IN (SELECT id FROM reports WHERE reporter_id = ANY($1::uuid[])) OR incident_id_or_sos_id IN (SELECT id FROM sos_requests WHERE requester_id = ANY($1::uuid[]))',
      [users],
    );
    await db.query(
      'DELETE FROM sos_recipients WHERE recipient_id = ANY($1::uuid[]) OR sos_id IN (SELECT id FROM sos_requests WHERE requester_id = ANY($1::uuid[]))',
      [users],
    );
    await db.query(
      'DELETE FROM sos_requests WHERE requester_id = ANY($1::uuid[])',
      [users],
    );
    await db.query(
      'DELETE FROM evidence_assets WHERE report_id IN (SELECT id FROM reports WHERE reporter_id = ANY($1::uuid[]))',
      [users],
    );
    await db.query(
      'DELETE FROM incident_report_links WHERE linked_by = ANY($1::uuid[]) OR report_id IN (SELECT id FROM reports WHERE reporter_id = ANY($1::uuid[]))',
      [users],
    );
    if (createdIncidentIds.length)
      await db.query('DELETE FROM incidents WHERE id = ANY($1::uuid[])', [
        createdIncidentIds,
      ]);
    await db.query(
      'DELETE FROM moderation_actions WHERE actor_id = ANY($1::uuid[]) OR target_id IN (SELECT id FROM reports WHERE reporter_id = ANY($1::uuid[]))',
      [users],
    );
    await db.query(
      'DELETE FROM confirmations WHERE user_id = ANY($1::uuid[]) OR report_id_or_incident_id IN (SELECT id FROM reports WHERE reporter_id = ANY($1::uuid[]))',
      [users],
    );
    await db.query('DELETE FROM reports WHERE reporter_id = ANY($1::uuid[])', [
      users,
    ]);
    if (createdSubscriptionIds.length)
      await db.query('DELETE FROM subscriptions WHERE id = ANY($1::uuid[])', [
        createdSubscriptionIds,
      ]);
    await db.query(
      'DELETE FROM subscriptions WHERE organisation_or_community_id = ANY($1::uuid[])',
      [createdCommunityIds],
    );
    await db.query(
      'DELETE FROM responders WHERE user_id = ANY($1::uuid[]) OR community_id = ANY($2::uuid[])',
      [users, createdCommunityIds],
    );
    await db.query(
      'DELETE FROM communities WHERE admin_id = ANY($1::uuid[]) OR id = ANY($2::uuid[])',
      [users, createdCommunityIds],
    );
    await db.query(
      'DELETE FROM notification_subscriptions WHERE user_id = ANY($1::uuid[])',
      [users],
    );
    await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
  }
  await db.end();
  await unlink(otpFile).catch(() => {});
});

test('frontend-facing API journey and trust boundaries', async (t) => {
  const author = await login();
  const witness = await login();
  const secondWitness = await login();
  const mod = await login();
  await db.query("UPDATE users SET role = 'moderator' WHERE id = $1", [
    mod.user.id,
  ]);
  const location = {
    latitude: 6.5158,
    longitude: 3.3711,
    areaName: 'Yaba',
    radius: 1000,
  };
  let report;
  await t.test('protected routes reject anonymous requests', async () => {
    assert.equal((await call('/auth/profile')).status, 401);
    assert.equal((await call('/notifications/inbox')).status, 401);
    assert.equal(
      (await call('/reports', { method: 'POST', body: {} })).status,
      401,
    );
  });
  await t.test(
    'Web Push configuration is authenticated and never returns the private key',
    async () => {
      assert.equal((await call('/notifications/push/config')).status, 401);
      const config = await call('/notifications/push/config', {
        token: author.token,
      });
      assert.equal(config.status, 200);
      assert.equal(config.data.enabled, true);
      assert.match(config.data.publicKey, /^[A-Za-z0-9_-]{87}$/);
      assert.equal(config.data.privateKey, undefined);
    },
  );
  await t.test(
    'device registration rejects arbitrary outbound endpoints',
    async () => {
      const response = await call('/notifications/push/devices', {
        token: author.token,
        method: 'POST',
        body: {
          endpoint: 'https://127.0.0.1/private',
          keys: { auth: 'a'.repeat(22), p256dh: 'b'.repeat(87) },
        },
      });
      assert.equal(response.status, 400);
    },
  );
  await t.test('profiles cannot assign their own privileged role', async () => {
    assert.equal(
      (
        await call('/auth/complete-profile', {
          token: author.token,
          method: 'PUT',
          body: { displayName: 'Test resident', role: 'moderator' },
        })
      ).status,
      400,
    );
    assert.equal(
      (await call('/auth/profile', { token: author.token })).data.role,
      'resident',
    );
  });
  await t.test(
    'subscriptions support multiple categories and user ownership',
    async () => {
      for (const category of ['traffic', 'weather'])
        assert.equal(
          (
            await call('/notifications/subscriptions', {
              token: witness.token,
              method: 'POST',
              body: {
                category,
                areaOrRadius: 5,
                latitude: location.latitude,
                longitude: location.longitude,
              },
            })
          ).status,
          201,
        );
      const prefs = await call(
        `/notifications/subscriptions?userId=${author.user.id}`,
        { token: witness.token },
      );
      assert.equal(prefs.data.length, 2);
      assert.ok(prefs.data.every((s) => s.userId === witness.user.id));
    },
  );
  await t.test('malformed report and feed input is rejected', async () => {
    assert.equal(
      (
        await call('/reports', {
          token: author.token,
          method: 'POST',
          body: { category: 'traffic', description: 'Missing location' },
        })
      ).status,
      400,
    );
    assert.equal((await call('/reports?limit=-1')).status, 400);
    assert.equal((await call('/reports?latitude=6.5')).status, 400);
  });
  await t.test(
    'postcodes are normalized, validated and rejected when malformed',
    async () => {
      const created = await call('/reports', {
        token: author.token,
        method: 'POST',
        body: {
          category: 'traffic',
          description: 'Integration test: congestion near a specific building.',
          location: {
            ...location,
            postcode: 'fc 02 a09 db 09',
          },
        },
      });
      assert.equal(
        created.status,
        201,
        JSON.stringify(created.data) + '\n' + serverLog,
      );
      assert.equal(created.data.postcode, 'FC02A09DB09');
      const stored = await db.query(
        'SELECT metadata FROM reports WHERE id = $1',
        [created.data.id],
      );
      assert.equal(stored.rows[0].metadata.postcode, 'FC02A09DB09');
      assert.equal(stored.rows[0].metadata.postcodeSource, 'format');

      const malformed = await call('/reports', {
        token: author.token,
        method: 'POST',
        body: {
          category: 'traffic',
          description: 'Integration test: postcode with wrong segment count.',
          location: { ...location, postcode: 'FC-02-A09' },
        },
      });
      assert.equal(malformed.status, 400);

      const updated = await call(`/reports/${created.data.id}`, {
        token: author.token,
        method: 'PUT',
        body: {
          location: { ...location, postcode: 'ek-01-a03-fk-01' },
        },
      });
      assert.equal(updated.status, 200);
      assert.equal(updated.data.postcode, 'EK01A03FK01');
      const badUpdate = await call(`/reports/${created.data.id}`, {
        token: author.token,
        method: 'PUT',
        body: {
          location: { ...location, postcode: 'XX-9Z-A0' },
        },
      });
      assert.equal(badUpdate.status, 400);

      const badLevel = await call(
        '/postcode/lookup?code=FC-02-A09-DB-09&level=9',
      );
      assert.equal(badLevel.status, 400);
      const badReverse = await call('/postcode/reverse?lat=99&lng=0');
      assert.equal(badReverse.status, 400);
    },
  );
  await t.test(
    'report creation persists an unverified public report',
    async () => {
      const created = await call('/reports', {
        token: author.token,
        method: 'POST',
        body: {
          category: 'traffic',
          description: 'Integration test: congestion around the bus stop.',
          location,
        },
      });
      assert.equal(created.status, 201);
      report = created.data;
      assert.equal(report.state, 'unverified');
      assert.ok(
        Math.abs(new Date(report.observedAt) - new Date(report.submittedAt)) <
          5000,
        'Observation and submission timestamps must share the same timezone semantics',
      );
      assert.equal((await call(`/reports/${report.id}`)).data.id, report.id);
      assert.equal(report.reporter.phone, undefined);
      assert.equal(report.reporter.metadata, undefined);
      assert.notEqual(report.coordinates.coordinates[0], location.longitude);
    },
  );
  await t.test(
    'nearby filters use the report location, category and radius',
    async () => {
      const nearby = await call(
        '/reports?latitude=6.5158&longitude=3.3711&radius=1000&category=traffic',
      );
      assert.equal(
        nearby.status,
        200,
        JSON.stringify(nearby.data) + '\n' + serverLog,
      );
      assert.ok(nearby.data.some((r) => r.id === report.id));
      const farAway = await call('/reports?latitude=0&longitude=0&radius=1000');
      assert.ok(!farAway.data.some((r) => r.id === report.id));
    },
  );
  await t.test(
    'matching subscriber receives a saved in-app notification, others do not',
    async () => {
      const inbox = await call('/notifications/inbox', {
        token: witness.token,
      });
      const notification = inbox.data.find(
        (n) => n.incidentIdOrSosId === report.id,
      );
      assert.equal(notification.channel, 'in_app');
      assert.equal(notification.payload.reportId, report.id);
      assert.equal(
        (await call('/notifications/inbox', { token: secondWitness.token }))
          .data.length,
        0,
      );
      assert.equal(
        (
          await call(`/notifications/inbox/${notification.id}/read`, {
            token: author.token,
            method: 'PUT',
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await call(`/notifications/inbox/${notification.id}/read`, {
            token: witness.token,
            method: 'PUT',
          })
        ).data.deliveryState,
        'acknowledged',
      );
    },
  );
  await t.test(
    'self-votes and confirmations without firsthand observation are rejected',
    async () => {
      assert.equal(
        (
          await call('/reports/confirm', {
            token: author.token,
            method: 'POST',
            body: { reportId: report.id, action: 'confirm', firsthand: true },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await call('/reports/confirm', {
            token: witness.token,
            method: 'POST',
            body: { reportId: report.id, action: 'confirm' },
          })
        ).status,
        400,
      );
    },
  );
  await t.test(
    'duplicate and concurrent votes do not inflate counts',
    async () => {
      const vote = (token) =>
        call('/reports/confirm', {
          token,
          method: 'POST',
          body: { reportId: report.id, action: 'confirm', firsthand: true },
        });
      const responses = await Promise.all([
        vote(witness.token),
        vote(witness.token),
        vote(secondWitness.token),
      ]);
      assert.ok(responses.every((r) => r.status === 201));
      const result = (await call(`/reports/${report.id}`)).data;
      assert.equal(result.confirmationsCount, 2);
      assert.equal(result.state, 'corroborated');
    },
  );
  await t.test(
    'changing a vote replaces it and marks the report disputed',
    async () => {
      const changed = await call('/reports/confirm', {
        token: witness.token,
        method: 'POST',
        body: { reportId: report.id, action: 'dispute', firsthand: false },
      });
      assert.equal(changed.data.confirmationsCount, 1);
      assert.equal(changed.data.disputesCount, 1);
      assert.equal(changed.data.state, 'disputed');
    },
  );
  await t.test(
    'residents cannot impersonate a moderator with actorId',
    async () => {
      assert.equal(
        (
          await call(
            `/moderation/reports/${report.id}/approve?actorId=${mod.user.id}`,
            {
              token: author.token,
              method: 'POST',
              body: { reason: 'Reviewed the supporting firsthand accounts.' },
            },
          )
        ).status,
        403,
      );
    },
  );
  await t.test(
    'moderator verification updates state and writes an audit trail',
    async () => {
      const reviewed = await call('/moderation/actions', {
        token: mod.token,
        method: 'POST',
        body: {
          targetId: report.id,
          targetType: 'report',
          action: 'approve',
          newState: 'verified',
          reason: 'Reviewed the supporting firsthand accounts.',
        },
      });
      assert.equal(reviewed.status, 201);
      assert.equal(
        (await call(`/reports/${report.id}`)).data.state,
        'verified',
      );
      const audit = await call(`/moderation/audit/${report.id}`, {
        token: mod.token,
      });
      assert.equal(audit.data[0].actorId, mod.user.id);
    },
  );
  await t.test(
    'trusted contributor is earned at ten distinct currently verified reports',
    async () => {
      for (let i = 0; i < 9; i++) {
        const created = await call('/reports', {
          token: author.token,
          method: 'POST',
          body: {
            category: 'community',
            description: `Integration test verified contribution ${i + 2}.`,
            location,
          },
        });
        assert.equal(created.status, 201);
        const verified = await call('/moderation/actions', {
          token: mod.token,
          method: 'POST',
          body: {
            targetId: created.data.id,
            targetType: 'report',
            action: 'approve',
            newState: 'verified',
            reason: 'Reviewed this illustrative test report independently.',
          },
        });
        assert.equal(verified.status, 201);
        const profile = (await call('/auth/profile', { token: author.token }))
          .data;
        assert.equal(profile.trustedContributor, i === 8);
      }
      assert.equal(
        (await call('/auth/profile', { token: author.token })).data
          .verifiedReports,
        10,
      );
      assert.equal(
        (await call(`/reports/${report.id}`)).data.reporter.trustedContributor,
        true,
      );
    },
  );
  await t.test(
    'account status is checked on every authenticated request',
    async () => {
      await db.query(
        "UPDATE users SET account_status = 'suspended' WHERE id = $1",
        [secondWitness.user.id],
      );
      assert.equal(
        (await call('/auth/profile', { token: secondWitness.token })).status,
        401,
      );
    },
  );
});

test('community safety, SOS, evidence, incidents, billing and analytics', async (t) => {
  const admin = await login();
  const responder = await login();
  const resident = await login();
  const mod = await login();
  await db.query("UPDATE users SET role = 'moderator' WHERE id = $1", [
    mod.user.id,
  ]);
  const polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [3.37, 6.51],
        [3.38, 6.51],
        [3.38, 6.52],
        [3.37, 6.52],
        [3.37, 6.51],
      ],
    ],
  };
  const location = { latitude: 6.515, longitude: 3.375, areaName: 'Yaba' };
  let community;

  await t.test('community creation validates geometry and promotes admin', async () => {
    const invalid = await call('/communities', {
      token: admin.token,
      method: 'POST',
      body: {
        name: 'Bad boundary',
        boundary: {
          type: 'Polygon',
          coordinates: [
            [
              [3.37, 6.51],
              [3.38, 6.51],
              [3.38, 6.52],
            ],
          ],
        },
      },
    });
    assert.equal(invalid.status, 400);

    const created = await call('/communities', {
      token: admin.token,
      method: 'POST',
      body: { name: 'E2E Yaba', boundary: polygon },
    });
    assert.equal(
      created.status,
      201,
      JSON.stringify(created.data) + '\n' + serverLog,
    );
    community = created.data;
    createdCommunityIds.push(community.id);
    assert.equal(community.adminId, admin.user.id);
    assert.equal(
      (await call('/auth/profile', { token: admin.token })).data.role,
      'community_admin',
    );
  });

  await t.test('community admin manages responders', async () => {
    const added = await call(`/communities/${community.id}/responders`, {
      token: admin.token,
      method: 'POST',
      body: { userId: responder.user.id, coverageArea: polygon },
    });
    assert.equal(
      added.status,
      201,
      JSON.stringify(added.data) + '\n' + serverLog,
    );
    assert.equal(added.data.responders.length, 1);
    assert.equal(
      (await call('/auth/profile', { token: responder.token })).data.role,
      'responder',
    );
    const forbidden = await call(
      `/communities/${community.id}/responders`,
      {
        token: resident.token,
        method: 'POST',
        body: { userId: resident.user.id },
      },
    );
    assert.equal(forbidden.status, 403);
  });

  await t.test('SOS fans out to nearby responders and the community admin', async () => {
    const created = await call('/sos', {
      token: resident.token,
      method: 'POST',
      body: {
        incidentType: 'medical',
        latitude: location.latitude,
        longitude: location.longitude,
        message: 'Need urgent help near the market.',
      },
    });
    assert.equal(
      created.status,
      201,
      JSON.stringify(created.data) + '\n' + serverLog,
    );
    createdSosIds.push(created.data.id);
    const recipientIds = created.data.recipients.map((r) => r.recipientId);
    assert.ok(recipientIds.includes(responder.user.id));
    assert.ok(recipientIds.includes(admin.user.id));
    assert.ok(!recipientIds.includes(resident.user.id));

    const assigned = await call('/sos/assigned', { token: responder.token });
    assert.ok(assigned.data.some((sos) => sos.id === created.data.id));

    const acknowledged = await call(`/sos/${created.data.id}/acknowledge`, {
      token: responder.token,
      method: 'PUT',
      body: { note: 'On the way' },
    });
    assert.equal(acknowledged.status, 200);
    assert.equal(acknowledged.data.state, 'acknowledged');

    const selfAck = await call(`/sos/${created.data.id}/acknowledge`, {
      token: resident.token,
      method: 'PUT',
      body: {},
    });
    assert.equal(selfAck.status, 403);

    const resolved = await call(`/sos/${created.data.id}/state`, {
      token: resident.token,
      method: 'PUT',
      body: { state: 'resolved', reason: 'help arrived' },
    });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.data.state, 'resolved');
  });

  await t.test('evidence is moderated before other residents can see it', async () => {
    const report = await call('/reports', {
      token: resident.token,
      method: 'POST',
      body: {
        category: 'community',
        description: 'Integration test: blocked drain near the market.',
        location,
      },
    });
    assert.equal(report.status, 201);

    const upload = await call(`/reports/${report.data.id}/evidence`, {
      token: resident.token,
      method: 'POST',
      body: {
        fileName: 'drain.png',
        mimeType: 'image/png',
        data: PNG_BASE64,
      },
    });
    assert.equal(
      upload.status,
      201,
      JSON.stringify(upload.data) + '\n' + serverLog,
    );
    assert.equal(upload.data.moderationState, 'pending');

    const hidden = await call(`/reports/${report.data.id}/evidence`, {
      token: responder.token,
    });
    assert.equal(hidden.data.length, 0);

    const approved = await call(`/evidence/${upload.data.id}/moderation`, {
      token: mod.token,
      method: 'PUT',
      body: { moderationState: 'approved', reason: 'clear image' },
    });
    assert.equal(
      approved.status,
      200,
      JSON.stringify(approved.data) + '\n' + serverLog,
    );

    const visible = await call(`/reports/${report.data.id}/evidence`, {
      token: responder.token,
    });
    assert.equal(visible.data.length, 1);

    const file = await fetch(base + `/evidence/${upload.data.id}/file`, {
      headers: { Authorization: `Bearer ${responder.token}` },
    });
    assert.equal(file.status, 200);
    assert.match(file.headers.get('content-type'), /^image\/png/);
    assert.ok((await file.arrayBuffer()).byteLength > 0);
  });

  await t.test('moderators group reports into incidents and verify them', async () => {
    const reports = [];
    for (let i = 0; i < 2; i++) {
      const created = await call('/reports', {
        token: resident.token,
        method: 'POST',
        body: {
          category: 'community',
          description: `Integration test: market drain overflow ${i + 1}.`,
          location,
        },
      });
      assert.equal(created.status, 201);
      reports.push(created.data.id);
    }

    const forbidden = await call('/incidents', {
      token: resident.token,
      method: 'POST',
      body: {
        canonicalCategory: 'flooding',
        summary: 'Resident should not create incidents.',
        latitude: location.latitude,
        longitude: location.longitude,
      },
    });
    assert.equal(forbidden.status, 403);

    const incident = await call('/incidents', {
      token: mod.token,
      method: 'POST',
      body: {
        canonicalCategory: 'flooding',
        summary: 'Market drain overflow affecting two streets.',
        latitude: location.latitude,
        longitude: location.longitude,
        severity: 'High',
        reportIds: reports,
      },
    });
    assert.equal(
      incident.status,
      201,
      JSON.stringify(incident.data) + '\n' + serverLog,
    );
    createdIncidentIds.push(incident.data.id);
    assert.equal(incident.data.reportLinks.length, 2);

    const verified = await call(`/incidents/${incident.data.id}/verification`, {
      token: mod.token,
      method: 'PUT',
      body: { verificationState: 'Verified' },
    });
    assert.equal(verified.data.verificationState, 'Verified');

    const listed = await call('/incidents?category=flooding', {
      token: resident.token,
    });
    assert.ok(listed.data.items.some((item) => item.id === incident.data.id));
  });

  await t.test('community billing is admin-only and cancellable', async () => {
    const forbidden = await call('/billing/subscriptions', {
      token: resident.token,
      method: 'POST',
      body: { communityId: community.id, plan: 'premium' },
    });
    assert.equal(forbidden.status, 403);

    const created = await call('/billing/subscriptions', {
      token: admin.token,
      method: 'POST',
      body: {
        communityId: community.id,
        plan: 'premium',
        billingReference: 'E2E-REF',
      },
    });
    assert.equal(
      created.status,
      201,
      JSON.stringify(created.data) + '\n' + serverLog,
    );
    createdSubscriptionIds.push(created.data.id);
    assert.equal(created.data.status, 'active');
    assert.ok(new Date(created.data.renewalDate) > new Date());

    const cancelled = await call(
      `/billing/subscriptions/${created.data.id}/cancel`,
      { token: admin.token, method: 'PUT' },
    );
    assert.equal(cancelled.data.status, 'cancelled');
  });

  await t.test('analytics is moderator-only and summarises activity', async () => {
    assert.equal(
      (await call('/analytics/reports', { token: resident.token })).status,
      403,
    );
    const reports = await call('/analytics/reports?sinceDays=1', {
      token: mod.token,
    });
    assert.equal(reports.status, 200);
    assert.ok(reports.data.total >= 3);
    assert.ok(Array.isArray(reports.data.byState));

    const incidents = await call('/analytics/incidents', { token: mod.token });
    assert.ok(incidents.data.total >= 1);
    const sos = await call('/analytics/sos?sinceDays=1', { token: mod.token });
    assert.ok(sos.data.total >= 1);
    assert.equal(
      (await call('/analytics/audit-logs', { token: mod.token })).status,
      403,
    );
  });

  await t.test('health endpoint reports database connectivity', async () => {
    const health = await call('/health');
    assert.equal(health.status, 200);
    assert.equal(health.data.database, 'up');
  });
});
