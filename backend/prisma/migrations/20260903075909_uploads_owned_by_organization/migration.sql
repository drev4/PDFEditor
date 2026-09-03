-- CreateTable
CREATE TABLE "uploads" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "uploaded_by_user_id" TEXT,
    "original_name" TEXT,
    "size" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uploads_key_key" ON "uploads"("key");

-- CreateIndex
CREATE INDEX "uploads_organization_id_idx" ON "uploads"("organization_id");

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: one row per document an existing form already points at
-- (features/0039).
--
-- Without it every form that exists today becomes unsaveable the moment
-- somebody edits it, because `assertUploadBelongsTo` would find no row for a
-- key the customer legitimately uploaded before this table existed.
--
-- The key is extracted the same way `pdfFilenameFrom` does it and no other
-- way: last path segment, then the `^[A-Za-z0-9_-]+\.pdf$` shape that
-- `middleware/upload.ts` mints. Anything that does not match is skipped rather
-- than given a row -- it never came from an upload and inventing an owner for
-- it would be a guess.
--
-- The owner is the organization of the OLDEST form referencing the key. On the
-- development dataset this migration was written against, 160 forms carried a
-- PDF, they resolved to 160 distinct keys, none failed to parse, and **no key
-- was referenced from more than one organization** -- so `DISTINCT ON` had no
-- ambiguity to resolve there. It is still written this way because the whole
-- reason this table exists is that the old code allowed exactly that, and a
-- migration that assumed it had never happened would fail on the one database
-- where it had.
--
-- **One residual case this cannot see, and nothing can see it after the fact.**
-- If the defect had already fired AND the victim's form was since deleted, only
-- the attacker's form survives to be counted -- so the multi-organization check
-- above finds nothing, and this backfill attributes the key to the attacker's
-- organization, certifying the wrong tenant as owner from here on. The evidence
-- that would distinguish it (the victim's row) is gone by definition, so there
-- is no query that detects it and no correction to apply. It is recorded here
-- rather than silently assumed away. On the dataset this ran against the risk is
-- bounded by the same measurement: 0 keys were referenced from more than one
-- organization, and every one of the 160 keys resolved to exactly one form.
--
-- `uploaded_by_user_id`, `original_name` and `size` stay NULL: nothing recorded
-- them at the time, and a plausible value is worse than an absent one.
INSERT INTO "uploads" ("id", "key", "organization_id", "created_at")
SELECT DISTINCT ON (key)
       gen_random_uuid()::text,
       key,
       organization_id,
       created_at
FROM (
  SELECT
    f."organization_id",
    f."created_at",
    substring(
      split_part(f."pdf_url", '/', array_length(string_to_array(f."pdf_url", '/'), 1))
      from '^[A-Za-z0-9_-]+\.pdf$'
    ) AS key
  FROM "forms" f
  WHERE f."pdf_url" IS NOT NULL
) referenced
WHERE key IS NOT NULL
ORDER BY key, created_at ASC;
