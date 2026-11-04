CREATE TABLE `share_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`hash` text NOT NULL,
	`prefix` text NOT NULL,
	`show_values` integer DEFAULT false NOT NULL,
	`show_locations` integer DEFAULT false NOT NULL,
	`show_notes` integer DEFAULT false NOT NULL,
	`show_minifigs` integer DEFAULT true NOT NULL,
	`expires_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_viewed_at` text,
	`views` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_links_hash_unique` ON `share_links` (`hash`);