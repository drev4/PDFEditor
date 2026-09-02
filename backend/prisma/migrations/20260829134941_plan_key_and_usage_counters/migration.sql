-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "plan_key" TEXT NOT NULL DEFAULT 'free';

-- CreateTable
CREATE TABLE "usage_counters" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "responses" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "usage_counters_organization_id_idx" ON "usage_counters"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "usage_counters_organization_id_period_key" ON "usage_counters"("organization_id", "period");

-- AddForeignKey
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
