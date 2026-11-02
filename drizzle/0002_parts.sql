CREATE TABLE `colors` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`rgb` text
);
--> statement-breakpoint
CREATE TABLE `set_parts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`set_id` integer NOT NULL,
	`match_no` integer DEFAULT 0 NOT NULL,
	`part_no` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`color_id` integer,
	`qty` integer NOT NULL,
	`extra` integer DEFAULT 0 NOT NULL,
	`alternate` integer DEFAULT false NOT NULL,
	`counterpart` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `set_parts_set` ON `set_parts` (`set_id`);--> statement-breakpoint
CREATE INDEX `set_parts_part` ON `set_parts` (`part_no`);