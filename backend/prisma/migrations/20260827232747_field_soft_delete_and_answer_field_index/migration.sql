-- AlterTable
ALTER TABLE "fields" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "answers_field_id_idx" ON "answers"("field_id");
