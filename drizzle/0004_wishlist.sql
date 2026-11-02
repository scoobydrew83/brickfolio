CREATE TABLE `wishlist` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`set_no` text NOT NULL,
	`name` text,
	`condition` text DEFAULT 'New' NOT NULL,
	`target` real,
	`notes` text,
	`year` integer,
	`image_url` text,
	`avg_sold` real,
	`min_sold` real,
	`qty_sold` integer,
	`bl_error` text,
	`last_updated` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wishlist_set_no` ON `wishlist` (`set_no`);