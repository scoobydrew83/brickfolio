-- #90: Brickfolio's people (#50) move into Better Auth's tables. Only inserts: the old `users` and
-- `collection_members` stay as they were (nothing reads them any more), so going back is possible.
-- Every login becomes a Better Auth user with that email (Tailscale logins and Access emails alike); `users.admin`
-- becomes role 'admin'. They have no password yet: in AUTH_MODE=better-auth an admin sets one (or they reset it).
INSERT INTO `user` (`id`, `name`, `email`, `email_verified`, `created_at`, `updated_at`, `role`, `last_seen_at`)
SELECT lower(hex(randomblob(16))), coalesce(u.name, u.login), u.login, 0,
       coalesce(CAST(strftime('%s', u.created_at) AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
       CAST(strftime('%s', 'now') AS INTEGER) * 1000,
       CASE WHEN u.admin THEN 'admin' ELSE 'user' END, u.last_seen_at
FROM `users` u
WHERE NOT EXISTS (SELECT 1 FROM `user` x WHERE x.email = u.login);
--> statement-breakpoint
-- Members whose login has no `users` row (shouldn't happen: setRole adds one).
INSERT INTO `user` (`id`, `name`, `email`, `email_verified`, `created_at`, `updated_at`, `role`)
SELECT lower(hex(randomblob(16))), m.login, m.login, 0, CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'user'
FROM (SELECT DISTINCT login FROM `collection_members`) m
WHERE NOT EXISTS (SELECT 1 FROM `user` x WHERE x.email = m.login);
--> statement-breakpoint
-- One organization per collection; its id is `col_<collection id>` so code can find it without a lookup.
INSERT INTO `organization` (`id`, `name`, `slug`, `created_at`, `collection_id`)
SELECT 'col_' || c.id, c.name, 'collection-' || c.id, CAST(strftime('%s', 'now') AS INTEGER) * 1000, c.id
FROM `collections` c
WHERE NOT EXISTS (SELECT 1 FROM `organization` o WHERE o.collection_id = c.id);
--> statement-breakpoint
INSERT INTO `member` (`id`, `organization_id`, `user_id`, `role`, `created_at`)
SELECT lower(hex(randomblob(16))), 'col_' || m.collection_id, x.id, m.role, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `collection_members` m
JOIN `user` x ON x.email = m.login
JOIN `organization` o ON o.id = 'col_' || m.collection_id
WHERE NOT EXISTS (SELECT 1 FROM `member` e WHERE e.organization_id = 'col_' || m.collection_id AND e.user_id = x.id);
