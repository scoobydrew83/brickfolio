ALTER TABLE `set_parts` ADD `source` text DEFAULT 'bricklink' NOT NULL;--> statement-breakpoint
ALTER TABLE `set_parts` ADD `mapped` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `sets` ADD `parts_source` text;