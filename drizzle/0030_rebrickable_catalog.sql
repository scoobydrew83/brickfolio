CREATE TABLE `catalog_files` (
	`name` text PRIMARY KEY NOT NULL,
	`etag` text,
	`last_modified` text,
	`rows` integer,
	`written` integer,
	`skipped` integer,
	`imported_at` text,
	`checked_at` text,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `rb_colors` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`rgb` text,
	`is_trans` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rb_inventories` (
	`id` integer PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`set_num` text NOT NULL,
	`parts_hash` text
);
--> statement-breakpoint
CREATE INDEX `rb_inventories_set_num` ON `rb_inventories` (`set_num`);--> statement-breakpoint
CREATE TABLE `rb_inventory_parts` (
	`inventory_id` integer NOT NULL,
	`part_num` text NOT NULL,
	`color_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	`is_spare` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rb_inventory_parts_inventory` ON `rb_inventory_parts` (`inventory_id`);--> statement-breakpoint
CREATE TABLE `rb_parts` (
	`part_num` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`part_cat_id` integer,
	`part_material` text
);
--> statement-breakpoint
CREATE TABLE `rb_sets` (
	`set_num` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`year` integer,
	`theme_id` integer,
	`num_parts` integer,
	`img_url` text
);
