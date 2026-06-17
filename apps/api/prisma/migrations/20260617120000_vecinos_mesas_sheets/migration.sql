-- Mesas automáticas e integración Google Sheets (eventos vecinos)
ALTER TABLE "Event" ADD COLUMN "mesaCount" INTEGER;
ALTER TABLE "Event" ADD COLUMN "googleSpreadsheetId" TEXT;
ALTER TABLE "Event" ADD COLUMN "googleSheetName" TEXT DEFAULT 'Acreditados';
