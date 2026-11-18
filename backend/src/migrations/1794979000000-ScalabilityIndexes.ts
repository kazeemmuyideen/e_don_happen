import { MigrationInterface, QueryRunner } from "typeorm";

const INDEXES = [
  {
    name: "IDX_reports_state_submitted",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_reports_state_submitted" ON "reports" ("state", "submitted_at" DESC)`,
  },
  {
    name: "IDX_reports_category_submitted",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_reports_category_submitted" ON "reports" ("category", "submitted_at" DESC)`,
  },
  {
    name: "IDX_reports_reporter_state",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_reports_reporter_state" ON "reports" ("reporter_id", "state")`,
  },
  {
    name: "IDX_reports_coordinates_gist",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_reports_coordinates_gist" ON "reports" USING gist ("coordinates_or_area")`,
  },
  {
    name: "IDX_notification_subs_category_location",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_notification_subs_category_location" ON "notification_subscriptions" ("category", "latitude", "longitude")`,
  },
  {
    name: "IDX_notification_subs_location_gist",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_notification_subs_location_gist" ON "notification_subscriptions" USING gist ((ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)::geography))`,
  },
  {
    name: "IDX_notification_deliveries_recipient_created",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_notification_deliveries_recipient_created" ON "notification_deliveries" ("recipient", "created_at" DESC)`,
  },
  {
    name: "IDX_notification_deliveries_state_created",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_notification_deliveries_state_created" ON "notification_deliveries" ("delivery_state", "created_at" DESC)`,
  },
  {
    name: "IDX_notification_deliveries_incident_created",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_notification_deliveries_incident_created" ON "notification_deliveries" ("incident_id_or_sos_id", "created_at" DESC)`,
  },
  {
    name: "IDX_notification_deliveries_recipient_state_created",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_notification_deliveries_recipient_state_created" ON "notification_deliveries" ("recipient", "delivery_state", "created_at" DESC)`,
  },
  {
    name: "IDX_sos_requests_requester_state_created",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_sos_requests_requester_state_created" ON "sos_requests" ("requester_id", "state", "created_at" DESC)`,
  },
  {
    name: "IDX_sos_requests_state_created",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_sos_requests_state_created" ON "sos_requests" ("state", "created_at" DESC)`,
  },
  {
    name: "IDX_sos_requests_location_gist",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_sos_requests_location_gist" ON "sos_requests" USING gist ("location_snapshot")`,
  },
  {
    name: "IDX_sos_recipients_recipient_created",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_sos_recipients_recipient_created" ON "sos_recipients" ("recipient_id", "created_at" DESC)`,
  },
  {
    name: "IDX_responders_coverage_gist",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_responders_coverage_gist" ON "responders" USING gist ("coverage_area")`,
  },
  {
    name: "IDX_communities_boundary_gist",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_communities_boundary_gist" ON "communities" USING gist ("boundary")`,
  },
  {
    name: "IDX_evidence_assets_report_scan_scanned",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_evidence_assets_report_scan_scanned" ON "evidence_assets" ("report_id", "scan_state", "scanned_at" DESC)`,
  },
  {
    name: "IDX_evidence_assets_report_moderation_scanned",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_evidence_assets_report_moderation_scanned" ON "evidence_assets" ("report_id", "moderation_state", "scanned_at" DESC)`,
  },
  {
    name: "IDX_moderation_actions_actor_timestamp",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_moderation_actions_actor_timestamp" ON "moderation_actions" ("actor_id", "timestamp" DESC)`,
  },
  {
    name: "IDX_moderation_actions_target_timestamp",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_moderation_actions_target_timestamp" ON "moderation_actions" ("target_id", "timestamp" DESC)`,
  },
  {
    name: "IDX_moderation_actions_appeal_timestamp",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_moderation_actions_appeal_timestamp" ON "moderation_actions" ("appeal_status", "timestamp" DESC)`,
  },
  {
    name: "IDX_audit_logs_actor_timestamp",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_audit_logs_actor_timestamp" ON "audit_logs" ("actor_id", "timestamp" DESC)`,
  },
  {
    name: "IDX_audit_logs_target_timestamp",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_audit_logs_target_timestamp" ON "audit_logs" ("target_id", "timestamp" DESC)`,
  },
  {
    name: "IDX_audit_logs_action_timestamp",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_audit_logs_action_timestamp" ON "audit_logs" ("action", "timestamp" DESC)`,
  },
  {
    name: "IDX_payment_attempts_status_created",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_payment_attempts_status_created" ON "payment_attempts" ("status", "created_at" DESC)`,
  },
  {
    name: "IDX_payment_attempts_community_created",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_payment_attempts_community_created" ON "payment_attempts" ("community_id", "created_at" DESC)`,
  },
  {
    name: "IDX_payment_events_reference_created",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_payment_events_reference_created" ON "payment_events" ("reference", "created_at" DESC)`,
  },
  {
    name: "IDX_payment_events_event_created",
    sql: `CREATE INDEX IF NOT EXISTS "IDX_payment_events_event_created" ON "payment_events" ("event", "created_at" DESC)`,
  },
];

export class ScalabilityIndexes1794979000000 implements MigrationInterface {
    name = 'ScalabilityIndexes1794979000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const index of INDEXES) {
            await queryRunner.query(index.sql);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const index of [...INDEXES].reverse()) {
            await queryRunner.query(`DROP INDEX IF EXISTS "${index.name}"`);
        }
    }
}
