CREATE TABLE `set_copies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`set_id` integer NOT NULL,
	`collection_id` integer,
	`status` text DEFAULT 'built' NOT NULL,
	`condition` text DEFAULT 'Used' NOT NULL,
	`missing_pct` real,
	`location` text,
	`acquired_date` text,
	`build_date` text,
	`price_paid` real,
	`tax` real,
	`shipping` real,
	`gwp` integer DEFAULT false NOT NULL,
	`est_value` real,
	`est_guide` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `set_copies_set` ON `set_copies` (`set_id`);--> statement-breakpoint
CREATE INDEX `set_copies_collection` ON `set_copies` (`collection_id`);--> statement-breakpoint
CREATE INDEX `set_copies_location` ON `set_copies` (`location`);--> statement-breakpoint
DROP INDEX `set_missing_parts_key`;--> statement-breakpoint
ALTER TABLE `set_missing_parts` ADD `copy_id` integer REFERENCES set_copies(id) ON DELETE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX `set_missing_parts_copy_key` ON `set_missing_parts` (`copy_id`,`type`,`part_no`,`color_id`);