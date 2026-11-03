CREATE TABLE `designer_projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`set_no` text,
	`series` text,
	`designer` text,
	`stage` text DEFAULT 'crowdfunding' NOT NULL,
	`preorder_start` text,
	`preorder_end` text,
	`price` real,
	`pieces` integer,
	`url` text,
	`notes` text,
	`watching` integer DEFAULT true NOT NULL,
	`open_alerted_at` text,
	`close_alerted_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
