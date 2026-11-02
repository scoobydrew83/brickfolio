CREATE TABLE `orders` (
	`order_id` integer NOT NULL,
	`direction` text NOT NULL,
	`date_ordered` text,
	`status` text NOT NULL,
	`counterparty` text,
	`items` integer,
	`lots` integer,
	`currency` text,
	`subtotal` real,
	`grand_total` real,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_id_direction` ON `orders` (`order_id`,`direction`);--> statement-breakpoint
CREATE INDEX `orders_date` ON `orders` (`date_ordered`);--> statement-breakpoint
CREATE TABLE `store_inventory` (
	`inventory_id` integer PRIMARY KEY NOT NULL,
	`item_no` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`color_id` integer,
	`color_name` text,
	`qty` integer NOT NULL,
	`condition` text NOT NULL,
	`unit_price` real,
	`description` text,
	`remarks` text,
	`synced_at` text NOT NULL
);
