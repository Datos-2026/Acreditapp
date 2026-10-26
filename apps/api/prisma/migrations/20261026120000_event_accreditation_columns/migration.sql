-- AlterTable
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "accreditationColumns" JSONB NOT NULL DEFAULT '[]';
