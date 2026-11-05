CREATE TABLE `price_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_kind` text NOT NULL,
	`item_id` text NOT NULL,
	`source` text NOT NULL,
	`type` text NOT NULL,
	`condition` text NOT NULL,
	`currency` text NOT NULL,
	`amount` real,
	`low` real,
	`high` real,
	`sample_size` integer,
	`observed_on` text NOT NULL,
	`observed_at` text NOT NULL,
	`url` text,
	`source_ref` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_obs_key` ON `price_observations` (`item_kind`,`item_id`,`source`,`type`,`condition`,`currency`,`observed_on`);--> statement-breakpoint
CREATE INDEX `price_obs_item` ON `price_observations` (`item_kind`,`item_id`,`observed_on`);--> statement-breakpoint
CREATE INDEX `price_obs_recent` ON `price_observations` (`type`,`observed_on`);--> statement-breakpoint
-- Copy the old snapshots over as BrickLink sold averages. They had no currency of their own, so they get today's
-- Settings currency (as the app showed them). Rebrickable-only figures were never priced.
INSERT OR IGNORE INTO `price_observations` (`item_kind`, `item_id`, `source`, `type`, `condition`, `currency`, `amount`, `low`, `high`, `sample_size`, `observed_on`, `observed_at`)
SELECT 'set', s.`set_no`, 'bricklink', 'sold_avg', p.`guide`, coalesce((SELECT `value` FROM `settings` WHERE `key` = 'currency'), 'USD'), p.`avg_sold`, p.`min_sold`, p.`max_sold`, p.`qty_sold`, p.`date`, p.`date` || 'T00:00:00.000Z'
FROM `price_snapshots` p JOIN `sets` s ON s.`id` = p.`set_id`;--> statement-breakpoint
INSERT OR IGNORE INTO `price_observations` (`item_kind`, `item_id`, `source`, `type`, `condition`, `currency`, `amount`, `sample_size`, `observed_on`, `observed_at`)
SELECT 'minifig', m.`fig_no`, 'bricklink', 'sold_avg', p.`guide`, coalesce((SELECT `value` FROM `settings` WHERE `key` = 'currency'), 'USD'), p.`avg_sold`, p.`qty_sold`, p.`date`, p.`date` || 'T00:00:00.000Z'
FROM `minifig_price_snapshots` p JOIN `minifigs` m ON m.`id` = p.`fig_id` WHERE m.`fig_no` IS NOT NULL;--> statement-breakpoint
DROP TABLE `minifig_price_snapshots`;--> statement-breakpoint
DROP TABLE `price_snapshots`;