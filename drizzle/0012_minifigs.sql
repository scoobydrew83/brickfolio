CREATE TABLE `cmf_figs` (
	`rb_fig_no` text NOT NULL,
	`theme_id` integer NOT NULL,
	`name` text NOT NULL,
	`num_parts` integer,
	`image_url` text,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cmf_figs_key` ON `cmf_figs` (`theme_id`,`rb_fig_no`);--> statement-breakpoint
CREATE TABLE `minifig_price_snapshots` (
	`fig_id` integer NOT NULL,
	`date` text NOT NULL,
	`guide` text NOT NULL,
	`avg_sold` real,
	`qty_sold` integer,
	FOREIGN KEY (`fig_id`) REFERENCES `minifigs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `minifig_price_snapshots_fig_date` ON `minifig_price_snapshots` (`fig_id`,`date`);--> statement-breakpoint
CREATE TABLE `minifigs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fig_no` text,
	`rb_fig_no` text,
	`name` text NOT NULL,
	`qty` integer DEFAULT 1 NOT NULL,
	`condition` text DEFAULT 'Used' NOT NULL,
	`location` text,
	`notes` text,
	`bl_name` text,
	`year` integer,
	`category_id` integer,
	`image_url` text,
	`avg_sold` real,
	`min_sold` real,
	`max_sold` real,
	`qty_sold` integer,
	`bl_error` text,
	`last_updated` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `minifigs_fig_no` ON `minifigs` (`fig_no`) WHERE fig_no is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `minifigs_rb_fig_no` ON `minifigs` (`rb_fig_no`) WHERE rb_fig_no is not null;