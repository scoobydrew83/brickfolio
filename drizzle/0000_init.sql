CREATE TABLE `api_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`hash` text NOT NULL,
	`prefix` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_used_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_hash_unique` ON `api_tokens` (`hash`);--> statement-breakpoint
CREATE TABLE `history` (
	`date` text PRIMARY KEY NOT NULL,
	`sets` integer NOT NULL,
	`copies` integer NOT NULL,
	`est_value` real NOT NULL,
	`avg_sold` real NOT NULL,
	`pieces` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`name` text PRIMARY KEY NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `price_snapshots` (
	`set_id` integer NOT NULL,
	`date` text NOT NULL,
	`guide` text NOT NULL,
	`avg_sold` real,
	`min_sold` real,
	`max_sold` real,
	`qty_sold` integer,
	FOREIGN KEY (`set_id`) REFERENCES `sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_snapshots_set_date` ON `price_snapshots` (`set_id`,`date`);--> statement-breakpoint
CREATE TABLE `sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`set_no` text NOT NULL,
	`name` text NOT NULL,
	`location` text,
	`condition` text,
	`registered` text,
	`missing_pct` real,
	`qty` integer DEFAULT 1 NOT NULL,
	`notes` text,
	`bl_name` text,
	`year` integer,
	`category_id` integer,
	`image_url` text,
	`pieces` integer,
	`part_lots` integer,
	`avg_sold` real,
	`min_sold` real,
	`max_sold` real,
	`qty_sold` integer,
	`est_value` real,
	`bl_error` text,
	`last_updated` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sets_set_no` ON `sets` (`set_no`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`finished_at` text,
	`status` text DEFAULT 'running' NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`processed` integer DEFAULT 0 NOT NULL,
	`errors` integer DEFAULT 0 NOT NULL,
	`message` text
);
--> statement-breakpoint
CREATE INDEX `sync_runs_started` ON `sync_runs` (`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `sync_runs_one_running` ON `sync_runs` (`status`) WHERE status = 'running';--> statement-breakpoint
INSERT INTO `locations` (`name`, `sort`) VALUES ('Display', 0), ('Storage', 1), ('Sell', 2);
--> statement-breakpoint
INSERT INTO `settings` (`key`, `value`) VALUES ('currency', 'USD');
