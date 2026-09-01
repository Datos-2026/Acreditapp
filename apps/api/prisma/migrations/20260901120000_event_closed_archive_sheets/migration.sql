-- AlterTable
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "archivedToSheetsAt" TIMESTAMP(3);

-- Backfill: eventos ya cerrados usan updatedAt como aproximación de closedAt.
UPDATE "Event"
SET "closedAt" = "updatedAt"
WHERE "status" = 'closed' AND "closedAt" IS NULL;

UPDATE "Event"
SET "archivedToSheetsAt" = "updatedAt"
WHERE "status" = 'archived' AND "archivedToSheetsAt" IS NULL;
