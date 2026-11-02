CREATE TABLE `set_models` (
	`set_id` integer PRIMARY KEY NOT NULL,
	`file_name` text NOT NULL,
	`content` text NOT NULL,
	`uploaded_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `sets`(`id`) ON UPDATE no action ON DELETE cascade
);
