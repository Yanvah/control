CREATE TABLE `operation_events` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`product_id` text NOT NULL,
	`operation` text NOT NULL,
	`target_id` text NOT NULL,
	`input_fingerprint` text NOT NULL,
	`event_type` text NOT NULL,
	`request_id` text,
	`safe_code` text,
	`duration_ms` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT "operation_events_type" CHECK("operation_events"."event_type" IN ('requested', 'succeeded', 'failed', 'unknown'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_events_attempt_type_idx` ON `operation_events` (`attempt_id`,`event_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `operation_events_terminal_idx` ON `operation_events` (`attempt_id`) WHERE "operation_events"."event_type" != 'requested';--> statement-breakpoint
CREATE INDEX `operation_events_product_created_idx` ON `operation_events` (`product_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER operation_events_no_update BEFORE UPDATE ON operation_events BEGIN SELECT RAISE(ABORT, 'Operation events are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER operation_events_no_delete BEFORE DELETE ON operation_events BEGIN SELECT RAISE(ABORT, 'Operation events are append-only'); END;
