-- One copy per unit of sets.qty, keeping the set's condition, location, Missing % and cached value.
-- Condition New becomes status sealed; Used, Partial and blank become built.
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < (SELECT coalesce(max(qty), 1) FROM sets))
INSERT INTO set_copies (set_id, status, condition, missing_pct, location, est_value, est_guide, created_at, updated_at)
SELECT s.id,
       CASE s.condition WHEN 'New' THEN 'sealed' ELSE 'built' END,
       coalesce(s.condition, 'Used'), s.missing_pct, s.location, s.est_value,
       CASE s.condition WHEN 'New' THEN 'N' ELSE 'U' END,
       s.created_at, s.updated_at
FROM sets s JOIN n ON n.i <= max(s.qty, 1)
WHERE NOT EXISTS (SELECT 1 FROM set_copies c WHERE c.set_id = s.id)
ORDER BY s.id, n.i;
--> statement-breakpoint
-- Marked missing parts move to each set's first copy.
UPDATE set_missing_parts SET copy_id = (SELECT min(c.id) FROM set_copies c WHERE c.set_id = set_missing_parts.set_id) WHERE copy_id IS NULL;
