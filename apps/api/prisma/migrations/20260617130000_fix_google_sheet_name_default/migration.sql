-- Quitar default legacy "Acreditados" que impedía provisionar hojas por evento.
UPDATE "Event" SET "googleSheetName" = NULL WHERE "googleSheetName" = 'Acreditados';

ALTER TABLE "Event" ALTER COLUMN "googleSheetName" DROP DEFAULT;
