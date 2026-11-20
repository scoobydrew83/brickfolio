CREATE TABLE `collection_members` (
	`collection_id` integer NOT NULL,
	`login` text NOT NULL,
	`role` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collection_members_login` ON `collection_members` (`collection_id`,`login`);--> statement-breakpoint
CREATE INDEX `collection_members_by_login` ON `collection_members` (`login`);--> statement-breakpoint
CREATE TABLE `users` (
	`login` text PRIMARY KEY NOT NULL,
	`name` text,
	`admin` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_seen_at` text
);
--> statement-breakpoint
ALTER TABLE `api_tokens` ADD `owner` text;--> statement-breakpoint
ALTER TABLE `share_links` ADD `created_by` text;