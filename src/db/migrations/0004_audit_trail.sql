CREATE TABLE `audit_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`request_id` text NOT NULL,
	`attempt_id` text,
	`actor_id` text,
	`product_id` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`event_type` text NOT NULL,
	`safe_code` text,
	`metadata_json` text NOT NULL,
	`duration_ms` integer,
	`created_at` integer NOT NULL,
	`previous_hash` text NOT NULL,
	`integrity_hash` text NOT NULL,
	CONSTRAINT "audit_event_type" CHECK("audit_events"."event_type" IN ('requested', 'succeeded', 'failed', 'unknown'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_events_id_unique` ON `audit_events` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `audit_request_event_idx` ON `audit_events` (`request_id`,`event_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `audit_request_terminal_idx` ON `audit_events` (`request_id`) WHERE "audit_events"."event_type" != 'requested';--> statement-breakpoint
CREATE INDEX `audit_attempt_idx` ON `audit_events` (`attempt_id`);--> statement-breakpoint
CREATE INDEX `audit_product_time_idx` ON `audit_events` (`product_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_action_time_idx` ON `audit_events` (`action`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_outcome_time_idx` ON `audit_events` (`event_type`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_time_idx` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'Audit events are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'Audit events are append-only'); END;
