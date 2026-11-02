CREATE TABLE `themes` (
	`id` integer PRIMARY KEY NOT NULL,
	`parent_id` integer,
	`name` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `sets` ADD `theme_id` integer;--> statement-breakpoint
ALTER TABLE `sets` ADD `minifigs` integer;--> statement-breakpoint
ALTER TABLE `sets` ADD `rb_synced_at` text;