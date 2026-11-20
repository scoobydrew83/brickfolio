CREATE TABLE `collection_history` (
	`date` text NOT NULL,
	`collection_id` integer NOT NULL,
	`sets` integer NOT NULL,
	`copies` integer NOT NULL,
	`est_value` real NOT NULL,
	`avg_sold` real NOT NULL,
	`pieces` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collection_history_day` ON `collection_history` (`date`,`collection_id`);--> statement-breakpoint
CREATE TABLE `collections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collections_name_unique` ON `collections` (`name`);--> statement-breakpoint
DROP INDEX `minifigs_fig_no`;--> statement-breakpoint
DROP INDEX `minifigs_rb_fig_no`;--> statement-breakpoint
ALTER TABLE `minifigs` ADD `collection_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `minifigs_collection_fig_no` ON `minifigs` (`collection_id`,`fig_no`) WHERE fig_no is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `minifigs_collection_rb_fig_no` ON `minifigs` (`collection_id`,`rb_fig_no`) WHERE rb_fig_no is not null;--> statement-breakpoint
CREATE INDEX `minifigs_fig_no_any` ON `minifigs` (`fig_no`);--> statement-breakpoint
CREATE INDEX `minifigs_rb_fig_no_any` ON `minifigs` (`rb_fig_no`);--> statement-breakpoint
ALTER TABLE `share_links` ADD `collection_id` integer;--> statement-breakpoint
INSERT INTO `collections` (`id`, `name`, `sort`) VALUES (1, 'My collection', 0);--> statement-breakpoint
UPDATE `set_copies` SET `collection_id` = 1 WHERE `collection_id` IS NULL;