CREATE TABLE `barcode_misses` (
	`gtin` text PRIMARY KEY NOT NULL,
	`checked_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`key` text PRIMARY KEY NOT NULL,
	`result` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idempotency_keys_created` ON `idempotency_keys` (`created_at`);--> statement-breakpoint
CREATE TABLE `set_barcodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`barcode` text NOT NULL,
	`format` text NOT NULL,
	`gtin` text NOT NULL,
	`set_no` text NOT NULL,
	`source` text NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`region` text,
	`source_ref` text,
	`name` text,
	`year` integer,
	`pieces` integer,
	`image_url` text,
	`first_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`verified_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `set_barcodes_key` ON `set_barcodes` (`gtin`,`set_no`,`source`);--> statement-breakpoint
CREATE INDEX `set_barcodes_gtin` ON `set_barcodes` (`gtin`);--> statement-breakpoint
CREATE INDEX `set_barcodes_set` ON `set_barcodes` (`set_no`);