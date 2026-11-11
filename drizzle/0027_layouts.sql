CREATE TABLE `layout_module_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`module_id` integer NOT NULL,
	`set_copy_id` integer,
	`build_id` integer,
	FOREIGN KEY (`module_id`) REFERENCES `layout_modules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`set_copy_id`) REFERENCES `set_copies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`build_id`) REFERENCES `builds`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "layout_module_items_one" CHECK(("layout_module_items"."set_copy_id" is null) <> ("layout_module_items"."build_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `layout_module_items_copy` ON `layout_module_items` (`module_id`,`set_copy_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `layout_module_items_build` ON `layout_module_items` (`module_id`,`build_id`);--> statement-breakpoint
CREATE INDEX `layout_module_items_set_copy` ON `layout_module_items` (`set_copy_id`);--> statement-breakpoint
CREATE INDEX `layout_module_items_build_id` ON `layout_module_items` (`build_id`);--> statement-breakpoint
CREATE TABLE `layout_modules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`layout_id` integer NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`w` integer DEFAULT 1 NOT NULL,
	`h` integer DEFAULT 1 NOT NULL,
	`rotation` integer DEFAULT 0 NOT NULL,
	`kind` text DEFAULT 'plain' NOT NULL,
	`name` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`layout_id`) REFERENCES `layouts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `layout_modules_layout` ON `layout_modules` (`layout_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `layout_modules_cell` ON `layout_modules` (`layout_id`,`x`,`y`);--> statement-breakpoint
CREATE TABLE `layouts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`cols` integer NOT NULL,
	`rows` integer NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
