-- AlterTable
ALTER TABLE "forms" ADD COLUMN     "asks_respondent_name" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "responses" ADD COLUMN     "respondent_name" TEXT;
