-- Toggle explícito para volcar acreditados a Google Sheets (GCBA y vecinos).
ALTER TABLE "Event" ADD COLUMN "enableGoogleSheets" BOOLEAN NOT NULL DEFAULT false;

-- Eventos vecinos que ya sincronizaban conservan el comportamiento.
UPDATE "Event"
SET "enableGoogleSheets" = true
WHERE "kind" = 'vecinos';
