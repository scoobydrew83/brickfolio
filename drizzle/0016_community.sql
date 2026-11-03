CREATE TABLE `minifig_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`factory` text DEFAULT '' NOT NULL,
	`year` text DEFAULT '' NOT NULL,
	`name` text NOT NULL,
	`series` text NOT NULL,
	`rb_fig_no` text,
	`source` text NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `minifig_codes_key` ON `minifig_codes` (`code`,`factory`,`year`,`source`);--> statement-breakpoint
CREATE INDEX `minifig_codes_code` ON `minifig_codes` (`code`);