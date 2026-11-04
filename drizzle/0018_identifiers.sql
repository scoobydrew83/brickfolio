CREATE TABLE `barcode_details` (
	`identifier_id` integer PRIMARY KEY NOT NULL,
	`barcode` text NOT NULL,
	`format` text NOT NULL,
	`name` text,
	`year` integer,
	`pieces` integer,
	`image_url` text,
	FOREIGN KEY (`identifier_id`) REFERENCES `identifiers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `identifiers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`scheme` text NOT NULL,
	`value` text NOT NULL,
	`canonical` text NOT NULL,
	`source` text NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`region` text,
	`source_ref` text,
	`first_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`verified_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identifiers_key` ON `identifiers` (`kind`,`scheme`,`value`,`canonical`,`source`);--> statement-breakpoint
CREATE INDEX `identifiers_lookup` ON `identifiers` (`kind`,`scheme`,`value`);--> statement-breakpoint
CREATE INDEX `identifiers_canonical` ON `identifiers` (`kind`,`canonical`);