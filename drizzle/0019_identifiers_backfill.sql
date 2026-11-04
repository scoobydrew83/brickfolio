-- Copies saved barcodes into identifiers (kind 'set', scheme 'gtin'), with what the provider said in barcode_details,
-- and maps minifigures that have both a BrickLink and a Rebrickable number. set_barcodes is dropped in the next migration.
INSERT OR IGNORE INTO `identifiers` (`kind`, `scheme`, `value`, `canonical`, `source`, `verified`, `region`, `source_ref`, `first_seen_at`, `last_seen_at`, `verified_at`, `created_at`, `updated_at`)
SELECT 'set', 'gtin', `gtin`, `set_no`, `source`, `verified`, `region`, `source_ref`, `first_seen_at`, `last_seen_at`, `verified_at`, `created_at`, `updated_at`
FROM `set_barcodes` ORDER BY `id`;
--> statement-breakpoint
INSERT OR IGNORE INTO `barcode_details` (`identifier_id`, `barcode`, `format`, `name`, `year`, `pieces`, `image_url`)
SELECT i.`id`, b.`barcode`, b.`format`, b.`name`, b.`year`, b.`pieces`, b.`image_url`
FROM `set_barcodes` b
JOIN `identifiers` i ON i.`kind` = 'set' AND i.`scheme` = 'gtin' AND i.`value` = b.`gtin` AND i.`canonical` = b.`set_no` AND i.`source` = b.`source`;
--> statement-breakpoint
INSERT OR IGNORE INTO `identifiers` (`kind`, `scheme`, `value`, `canonical`, `source`, `verified`, `verified_at`)
SELECT 'minifig', 'rebrickable', lower(`rb_fig_no`), lower(`fig_no`), 'user', 1, `updated_at`
FROM `minifigs` WHERE `fig_no` IS NOT NULL AND `rb_fig_no` IS NOT NULL;
