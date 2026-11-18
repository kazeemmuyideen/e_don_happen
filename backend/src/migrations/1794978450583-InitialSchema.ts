import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1794978450583 implements MigrationInterface {
    name = 'InitialSchema1794978450583'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS postgis`);
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE TABLE "sos_requests" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "requester_id" uuid NOT NULL, "incident_type" character varying(100) NOT NULL, "message" character varying(500), "location_label" character varying(200), "location_snapshot" geometry(Point,4326) NOT NULL, "sharing_policy" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "state" character varying(50) NOT NULL DEFAULT 'active', "escalation_policy" jsonb, CONSTRAINT "PK_b5c8cd9c2d6b1a9936f2d2f86d8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "sos_recipients" ("sos_id" uuid NOT NULL, "recipient_id" uuid NOT NULL, "role" character varying(50) NOT NULL, "channel" character varying(50) NOT NULL, "delivery_state" character varying(50) NOT NULL DEFAULT 'pending', "acknowledgement_state" character varying(50) NOT NULL DEFAULT 'unacknowledged', "timestamps" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9e1bc9f5af2498fb39d09fa4f2a" PRIMARY KEY ("sos_id", "recipient_id"))`);
        await queryRunner.query(`CREATE TABLE "sos_escalation_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "sos_id" uuid NOT NULL, "level" integer NOT NULL, "due_at" TIMESTAMP WITH TIME ZONE NOT NULL, "fired_at" TIMESTAMP WITH TIME ZONE, "channel" character varying(50) NOT NULL, "recipient_id" uuid, "provider_message_id" character varying(200), "outcome" character varying(50) NOT NULL, "metadata" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f74ffd758de1748b919f0eee4fb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_b5203e927a59fecb14fb292b93" ON "sos_escalation_events" ("sos_id", "level") `);
        await queryRunner.query(`CREATE TABLE "reports" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "reporter_id" uuid NOT NULL, "category" character varying(50) NOT NULL, "description" text NOT NULL, "observed_at" TIMESTAMP WITH TIME ZONE NOT NULL, "submitted_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "coordinates_or_area" geometry(Point,4326) NOT NULL, "location_precision" character varying(50) NOT NULL, "state" character varying(50) NOT NULL DEFAULT 'unverified', "evidence_references" jsonb, "metadata" jsonb, "confirmations_count" integer NOT NULL DEFAULT '0', "disputes_count" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_d9013193989303580053c0b5ef6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "evidence_assets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "report_id" uuid NOT NULL, "storage_key" character varying(500) NOT NULL, "media_metadata" jsonb, "moderation_state" character varying(50) NOT NULL DEFAULT 'pending', "retention_deadline" TIMESTAMP WITH TIME ZONE, "scan_state" character varying(20) NOT NULL DEFAULT 'clean', "scan_engine" character varying(50), "scanned_at" TIMESTAMP WITH TIME ZONE, "scan_signature" text, CONSTRAINT "PK_5e71a49c1656395ab7d345153fa" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "web_push_devices" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "endpoint" text NOT NULL, "keys" jsonb NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_735a26dda881180f1ca0c94f941" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_24c6abb3797d04b11f6ae40433" ON "web_push_devices" ("user_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_63882b77549ed651ded5750d43" ON "web_push_devices" ("endpoint") `);
        await queryRunner.query(`CREATE TABLE "notification_subscriptions" ("user_id" uuid NOT NULL, "category" character varying(50) NOT NULL, "latitude" double precision NOT NULL DEFAULT '6.5244', "longitude" double precision NOT NULL DEFAULT '3.3792', "area_or_radius" double precision NOT NULL, "priority_threshold" character varying(20) NOT NULL DEFAULT 'normal', "quiet_hours" jsonb, CONSTRAINT "PK_8b745012f9f95e75c19d9f5da82" PRIMARY KEY ("user_id", "category"))`);
        await queryRunner.query(`CREATE TABLE "notification_deliveries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "incident_id_or_sos_id" uuid, "recipient" uuid NOT NULL, "channel" character varying(50) NOT NULL, "provider" character varying(50) NOT NULL, "attempt" integer NOT NULL DEFAULT '1', "delivery_state" character varying(50) NOT NULL DEFAULT 'pending', "timestamps" jsonb, "cost_metadata" jsonb, "payload" jsonb, "push_state" character varying NOT NULL DEFAULT 'none', "push_attempts" integer NOT NULL DEFAULT '0', "push_next_attempt_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_81daeff81f237bd384f7cfc4a4c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "moderation_actions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "actor_id" uuid NOT NULL, "target_id" uuid NOT NULL, "target_type" character varying(50) NOT NULL, "action" character varying(50) NOT NULL, "reason" text NOT NULL, "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "appeal_status" character varying(20) NOT NULL DEFAULT 'none', "metadata" jsonb, CONSTRAINT "PK_d259906fb4d2a5ef718f1f66e35" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "incidents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "canonical_category" character varying(100) NOT NULL, "summary" text NOT NULL, "canonical_location" geometry(Point,4326) NOT NULL, "first_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "last_updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "status" character varying(50) NOT NULL DEFAULT 'Open', "verification_state" character varying(50) NOT NULL DEFAULT 'Unverified', "severity" character varying(20) NOT NULL DEFAULT 'Medium', CONSTRAINT "PK_ccb34c01719889017e2246469f9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "incident_report_links" ("incident_id" uuid NOT NULL, "report_id" uuid NOT NULL, "link_type" character varying(50) NOT NULL, "linked_by" uuid NOT NULL, "linked_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_15ec933c72e4fe79ba0ad75444b" PRIMARY KEY ("incident_id", "report_id"))`);
        await queryRunner.query(`CREATE TABLE "confirmations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "report_id_or_incident_id" uuid NOT NULL, "user_id" uuid NOT NULL, "firsthand_flag" boolean NOT NULL DEFAULT false, "confirmation_or_dispute" character varying(20) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8a3991e9a203e6460dcb9048746" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_e4912ec521aaa6d86cb65178e7" ON "confirmations" ("report_id_or_incident_id", "user_id") `);
        await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('resident', 'responder', 'moderator', 'community_admin', 'super_admin')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "phone" character varying(20) NOT NULL, "display_name" character varying(100) NOT NULL, "account_status" character varying(20) NOT NULL DEFAULT 'pending_verification', "role" "public"."users_role_enum" NOT NULL DEFAULT 'resident', "community_id" uuid, "language" character varying(10) NOT NULL DEFAULT 'en', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "last_login_at" TIMESTAMP WITH TIME ZONE, "privacy_settings" jsonb, "metadata" jsonb, CONSTRAINT "UQ_a000cca60bcf04454e727699490" UNIQUE ("phone"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_7dd1db6463f2f62f035cec54ad" ON "users" ("account_status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a000cca60bcf04454e72769949" ON "users" ("phone") `);
        await queryRunner.query(`CREATE TABLE "user_location_preferences" ("user_id" uuid NOT NULL, "selected_area" geometry(Polygon,4326), "radius" double precision, "permission_state" character varying(20) NOT NULL DEFAULT 'denied', "retention_preference" character varying(50) NOT NULL DEFAULT 'default', CONSTRAINT "PK_b8b804f9026c3d72ffbb3b4c364" PRIMARY KEY ("user_id"))`);
        await queryRunner.query(`CREATE TABLE "responders" ("user_id" uuid NOT NULL, "community_id" uuid NOT NULL, "qualifications_or_role_claims" jsonb, "availability_window" jsonb, "coverage_area" geometry(Polygon,4326), "status" character varying(20) NOT NULL DEFAULT 'active', CONSTRAINT "PK_0701eebf04de4bead65c8b962a6" PRIMARY KEY ("user_id"))`);
        await queryRunner.query(`CREATE TABLE "communities" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, "boundary" geometry(Polygon,4326) NOT NULL, "admin_id" uuid NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'active', "plan" character varying(50) NOT NULL DEFAULT 'standard', "responder_coverage_configuration" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_fea1fe83c86ccde9d0a089e7ea2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "subscriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organisation_or_community_id" uuid NOT NULL, "plan" character varying(50) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'active', "renewal_date" TIMESTAMP WITH TIME ZONE NOT NULL, "billing_reference" character varying(100), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a87248d73155605cf782be9ee5e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "payment_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "event_id" character varying(200) NOT NULL, "event" character varying(100) NOT NULL, "reference" character varying(200), "status" character varying(50), "payload" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_4f36a430ea944f1d250f0500d13" UNIQUE ("event_id"), CONSTRAINT "PK_9f1d16fc78b33e676940a32e8b5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "payment_attempts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "reference" character varying(200) NOT NULL, "community_id" uuid NOT NULL, "plan" character varying(50) NOT NULL, "amount" integer NOT NULL, "currency" character varying(10) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'pending', "authorization_url" text, "subscription_id" uuid, "provider_response" jsonb, "completed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_512b5990d764ce231bff0e44f2e" UNIQUE ("reference"), CONSTRAINT "PK_a0d8a67c07a0fef98dfd20214e5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "actor_id" uuid NOT NULL, "action" character varying(100) NOT NULL, "target_id" uuid, "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "source" character varying(50) NOT NULL, "reason" text, "metadata" jsonb, CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "sos_requests" ADD CONSTRAINT "FK_cc455db1032d8bade7c3f0b7817" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sos_recipients" ADD CONSTRAINT "FK_e720969743555f4693f140dd2e6" FOREIGN KEY ("sos_id") REFERENCES "sos_requests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sos_recipients" ADD CONSTRAINT "FK_9752d504128d0afb28b7f8c9aca" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "reports" ADD CONSTRAINT "FK_9459b9bf907a3807ef7143d2ead" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "evidence_assets" ADD CONSTRAINT "FK_622d3c96bfd734792c23bdcfaed" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "web_push_devices" ADD CONSTRAINT "FK_24c6abb3797d04b11f6ae404339" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "notification_subscriptions" ADD CONSTRAINT "FK_565bddc96d2492c5bf99274575e" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "notification_deliveries" ADD CONSTRAINT "FK_03c5cc40ae1d39408e7e4ca113f" FOREIGN KEY ("recipient") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "moderation_actions" ADD CONSTRAINT "FK_fb3a6f1f4f84c2e834e86bea465" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "incident_report_links" ADD CONSTRAINT "FK_cbe494e2495e3e4cd4376c3aa0f" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "incident_report_links" ADD CONSTRAINT "FK_7a95c2b5f2af24d90a998750cbb" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "incident_report_links" ADD CONSTRAINT "FK_5e78b506512fec3d7ec89c34654" FOREIGN KEY ("linked_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "confirmations" ADD CONSTRAINT "FK_1064a35689548a606231b93db2c" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "responders" ADD CONSTRAINT "FK_0701eebf04de4bead65c8b962a6" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "responders" ADD CONSTRAINT "FK_3b014e5eda65e8a27e97a92d4da" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "communities" ADD CONSTRAINT "FK_f854d90354fe2271b45f1ebbe6f" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD CONSTRAINT "FK_9c95c43f3ed4c5f903f4a3c8dec" FOREIGN KEY ("organisation_or_community_id") REFERENCES "communities"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_177183f29f438c488b5e8510cdb" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_177183f29f438c488b5e8510cdb"`);
        await queryRunner.query(`ALTER TABLE "subscriptions" DROP CONSTRAINT "FK_9c95c43f3ed4c5f903f4a3c8dec"`);
        await queryRunner.query(`ALTER TABLE "communities" DROP CONSTRAINT "FK_f854d90354fe2271b45f1ebbe6f"`);
        await queryRunner.query(`ALTER TABLE "responders" DROP CONSTRAINT "FK_3b014e5eda65e8a27e97a92d4da"`);
        await queryRunner.query(`ALTER TABLE "responders" DROP CONSTRAINT "FK_0701eebf04de4bead65c8b962a6"`);
        await queryRunner.query(`ALTER TABLE "confirmations" DROP CONSTRAINT "FK_1064a35689548a606231b93db2c"`);
        await queryRunner.query(`ALTER TABLE "incident_report_links" DROP CONSTRAINT "FK_5e78b506512fec3d7ec89c34654"`);
        await queryRunner.query(`ALTER TABLE "incident_report_links" DROP CONSTRAINT "FK_7a95c2b5f2af24d90a998750cbb"`);
        await queryRunner.query(`ALTER TABLE "incident_report_links" DROP CONSTRAINT "FK_cbe494e2495e3e4cd4376c3aa0f"`);
        await queryRunner.query(`ALTER TABLE "moderation_actions" DROP CONSTRAINT "FK_fb3a6f1f4f84c2e834e86bea465"`);
        await queryRunner.query(`ALTER TABLE "notification_deliveries" DROP CONSTRAINT "FK_03c5cc40ae1d39408e7e4ca113f"`);
        await queryRunner.query(`ALTER TABLE "notification_subscriptions" DROP CONSTRAINT "FK_565bddc96d2492c5bf99274575e"`);
        await queryRunner.query(`ALTER TABLE "web_push_devices" DROP CONSTRAINT "FK_24c6abb3797d04b11f6ae404339"`);
        await queryRunner.query(`ALTER TABLE "evidence_assets" DROP CONSTRAINT "FK_622d3c96bfd734792c23bdcfaed"`);
        await queryRunner.query(`ALTER TABLE "reports" DROP CONSTRAINT "FK_9459b9bf907a3807ef7143d2ead"`);
        await queryRunner.query(`ALTER TABLE "sos_recipients" DROP CONSTRAINT "FK_9752d504128d0afb28b7f8c9aca"`);
        await queryRunner.query(`ALTER TABLE "sos_recipients" DROP CONSTRAINT "FK_e720969743555f4693f140dd2e6"`);
        await queryRunner.query(`ALTER TABLE "sos_requests" DROP CONSTRAINT "FK_cc455db1032d8bade7c3f0b7817"`);
        await queryRunner.query(`DROP TABLE "audit_logs"`);
        await queryRunner.query(`DROP TABLE "payment_attempts"`);
        await queryRunner.query(`DROP TABLE "payment_events"`);
        await queryRunner.query(`DROP TABLE "subscriptions"`);
        await queryRunner.query(`DROP TABLE "communities"`);
        await queryRunner.query(`DROP TABLE "responders"`);
        await queryRunner.query(`DROP TABLE "user_location_preferences"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a000cca60bcf04454e72769949"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7dd1db6463f2f62f035cec54ad"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e4912ec521aaa6d86cb65178e7"`);
        await queryRunner.query(`DROP TABLE "confirmations"`);
        await queryRunner.query(`DROP TABLE "incident_report_links"`);
        await queryRunner.query(`DROP TABLE "incidents"`);
        await queryRunner.query(`DROP TABLE "moderation_actions"`);
        await queryRunner.query(`DROP TABLE "notification_deliveries"`);
        await queryRunner.query(`DROP TABLE "notification_subscriptions"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_63882b77549ed651ded5750d43"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_24c6abb3797d04b11f6ae40433"`);
        await queryRunner.query(`DROP TABLE "web_push_devices"`);
        await queryRunner.query(`DROP TABLE "evidence_assets"`);
        await queryRunner.query(`DROP TABLE "reports"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b5203e927a59fecb14fb292b93"`);
        await queryRunner.query(`DROP TABLE "sos_escalation_events"`);
        await queryRunner.query(`DROP TABLE "sos_recipients"`);
        await queryRunner.query(`DROP TABLE "sos_requests"`);
    }

}
