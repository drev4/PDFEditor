-- Gives every existing user a personal organization, makes them its owner, and
-- moves their forms into it. Written as a migration rather than a script so it
-- cannot be forgotten in an environment nobody remembers to run scripts in.
--
-- Idempotent: re-running inserts nothing and updates nothing. That matters
-- because a half-applied migration has to be safe to re-apply.

-- 1. One organization per user.
--
-- The slug is derived from the user id, so it is unique without a collision
-- loop and stable if this is re-run. The name comes from the user's name, or
-- the local part of their email when they never set one.
INSERT INTO "organizations" ("id", "name", "slug", "created_at", "updated_at")
SELECT
    gen_random_uuid()::text,
    COALESCE(NULLIF(TRIM(u."name"), ''), split_part(u."email", '@', 1)),
    'org-' || substr(replace(u."id", '-', ''), 1, 12),
    u."created_at",
    NOW()
FROM "users" u
WHERE NOT EXISTS (
    SELECT 1 FROM "organizations" o
    WHERE o."slug" = 'org-' || substr(replace(u."id", '-', ''), 1, 12)
);

-- 2. Each user owns their personal organization.
INSERT INTO "memberships" ("id", "organization_id", "user_id", "role", "created_at")
SELECT
    gen_random_uuid()::text,
    o."id",
    u."id",
    'owner'::"MembershipRole",
    u."created_at"
FROM "users" u
JOIN "organizations" o
    ON o."slug" = 'org-' || substr(replace(u."id", '-', ''), 1, 12)
WHERE NOT EXISTS (
    SELECT 1 FROM "memberships" m
    WHERE m."organization_id" = o."id" AND m."user_id" = u."id"
);

-- 3. Every form moves to the organization of the user who owned it.
UPDATE "forms" f
SET "organization_id" = m."organization_id"
FROM "memberships" m
WHERE m."user_id" = f."user_id"
  AND m."role" = 'owner'
  AND f."organization_id" IS NULL;

-- 4. Refuse to continue if anything was left behind.
--
-- The next migration makes this column NOT NULL, and would fail there with a
-- constraint error that says nothing about why. Failing here names the problem
-- while the data that caused it is still in front of you.
DO $$
DECLARE orphaned INT;
BEGIN
    SELECT COUNT(*) INTO orphaned FROM "forms" WHERE "organization_id" IS NULL;
    IF orphaned > 0 THEN
        RAISE EXCEPTION
            'Backfill incomplete: % form(s) have no organization. Every form must belong to the personal organization of its owner before organization_id can be made NOT NULL.',
            orphaned;
    END IF;
END $$;
