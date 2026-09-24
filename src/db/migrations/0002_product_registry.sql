CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`endpoint` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`key_id` text NOT NULL,
	`encrypted_secret` text NOT NULL,
	`secret_iv` text NOT NULL,
	`secret_auth_tag` text NOT NULL,
	`encryption_key_version` integer NOT NULL,
	`secret_fingerprint` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`capabilities_json` text,
	`last_connected_at` integer,
	`last_tested_at` integer,
	`last_connection_status` text DEFAULT 'unknown' NOT NULL,
	`last_safe_error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "products_connection_status" CHECK("products"."last_connection_status" IN ('unknown', 'online', 'offline', 'degraded')),
	CONSTRAINT "products_encryption_key_version" CHECK("products"."encryption_key_version" > 0),
	CONSTRAINT "products_revision" CHECK("products"."revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_secret_fingerprint_idx` ON `products` (`secret_fingerprint`);--> statement-breakpoint
CREATE INDEX `products_enabled_name_idx` ON `products` (`enabled`,`name`);