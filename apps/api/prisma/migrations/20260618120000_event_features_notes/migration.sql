-- AlterTable
ALTER TABLE "Event" ADD COLUMN "enableMesas" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Event" ADD COLUMN "enableNotes" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "EventPerson" ADD COLUMN "eventNotes" TEXT;

-- Eventos vecinos con mesas ya configuradas: activar toggle
UPDATE "Event" SET "enableMesas" = true WHERE "mesaCount" IS NOT NULL AND "mesaCount" > 0;
