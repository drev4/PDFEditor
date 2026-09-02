-- Contract step: organization_id becomes the owner, user_id becomes provenance.
--
-- Hand-written rather than generated. `prisma migrate dev` plans a rename it
-- cannot see as a rename: DROP COLUMN "user_id" followed by ADD COLUMN
-- "created_by_user_id", which silently discards who created every existing
-- form. RENAME COLUMN keeps the data.

-- 1. The backfill in the previous migration guarantees this is now safe. If it
--    is not, that migration raised before this one ever ran.
ALTER TABLE "forms" ALTER COLUMN "organization_id" SET NOT NULL;

-- 2. user_id no longer means ownership. Rename it so nothing can mistake it for
--    an authorization input, and drop the index that existed to serve the
--    ownership lookups that are now membership lookups.
DROP INDEX IF EXISTS "forms_user_id_idx";
ALTER TABLE "forms" RENAME COLUMN "user_id" TO "created_by_user_id";

-- 3. Deleting a user must no longer destroy forms.
--
--    Until now this FK was ON DELETE CASCADE, so removing a user removed their
--    forms, their fields and every response ever collected through them. The
--    organization owns those forms, and other members may depend on them, so
--    the row has to survive its creator. Losing the record of who made it is
--    the price; blocking user deletion forever would be worse.
ALTER TABLE "forms" DROP CONSTRAINT "forms_user_id_fkey";
ALTER TABLE "forms" ALTER COLUMN "created_by_user_id" DROP NOT NULL;
ALTER TABLE "forms" ADD CONSTRAINT "forms_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
