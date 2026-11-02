CREATE TABLE `build_parts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`build_id` integer NOT NULL,
	`part_no` text NOT NULL,
	`color_id` integer,
	`qty` integer NOT NULL,
	`mapped` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`build_id`) REFERENCES `builds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `build_parts_build` ON `build_parts` (`build_id`);--> statement-breakpoint
CREATE TABLE `builds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`moc_no` text NOT NULL,
	`name` text NOT NULL,
	`num_parts` integer,
	`image_url` text,
	`url` text,
	`designer` text,
	`source_set_no` text NOT NULL,
	`parts_fetched_at` text,
	`fetched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `builds_moc_no_unique` ON `builds` (`moc_no`);--> statement-breakpoint
ALTER TABLE `sets` ADD `rb_alternates_at` text;