CREATE TABLE `part_prices` (
	`type` text NOT NULL,
	`part_no` text NOT NULL,
	`color_id` integer DEFAULT -1 NOT NULL,
	`guide` text NOT NULL,
	`currency` text NOT NULL,
	`avg_sold` real,
	`qty_sold` integer,
	`error` text,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `part_prices_key` ON `part_prices` (`type`,`part_no`,`color_id`,`guide`,`currency`);--> statement-breakpoint
CREATE INDEX `part_prices_fetched` ON `part_prices` (`fetched_at`);