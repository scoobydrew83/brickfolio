CREATE TABLE `set_missing_parts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`set_id` integer NOT NULL,
	`part_no` text NOT NULL,
	`color_id` integer DEFAULT -1 NOT NULL,
	`type` text NOT NULL,
	`qty` integer NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `set_missing_parts_key` ON `set_missing_parts` (`set_id`,`type`,`part_no`,`color_id`);