CREATE TABLE `part_allocations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`build_id` integer NOT NULL,
	`lot_id` integer NOT NULL,
	`qty` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`build_id`) REFERENCES `builds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lot_id`) REFERENCES `part_lots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `part_allocations_key` ON `part_allocations` (`build_id`,`lot_id`);--> statement-breakpoint
CREATE INDEX `part_allocations_lot` ON `part_allocations` (`lot_id`);--> statement-breakpoint
CREATE TABLE `part_lot_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`file_name` text,
	`location` text,
	`mode` text NOT NULL,
	`lots` integer NOT NULL,
	`pieces` integer NOT NULL,
	`undone_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `part_lots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text DEFAULT 'PART' NOT NULL,
	`part_no` text NOT NULL,
	`color_id` integer DEFAULT -1 NOT NULL,
	`name` text,
	`qty` integer NOT NULL,
	`condition` text,
	`location` text,
	`source` text DEFAULT 'bin' NOT NULL,
	`set_copy_id` integer,
	`approximate` integer DEFAULT false NOT NULL,
	`mapped` integer DEFAULT true NOT NULL,
	`import_batch` text,
	`import_prev_qty` integer,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`set_copy_id`) REFERENCES `set_copies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `part_lots_part` ON `part_lots` (`part_no`,`color_id`);--> statement-breakpoint
CREATE INDEX `part_lots_location` ON `part_lots` (`location`);--> statement-breakpoint
CREATE INDEX `part_lots_set_copy` ON `part_lots` (`set_copy_id`);--> statement-breakpoint
CREATE INDEX `part_lots_batch` ON `part_lots` (`import_batch`);--> statement-breakpoint
ALTER TABLE `builds` ADD `kind` text DEFAULT 'alternate' NOT NULL;