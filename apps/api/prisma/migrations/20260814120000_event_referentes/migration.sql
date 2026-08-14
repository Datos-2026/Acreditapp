-- Flag de evento + agrupación por referente.
ALTER TABLE "Event" ADD COLUMN "enableReferentes" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "EventPerson" ADD COLUMN "isReferente" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EventPerson" ADD COLUMN "referenteId" TEXT;

CREATE TABLE "EventReferente" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "phone" TEXT,
    "eventPersonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventReferente_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventReferente_eventPersonId_key" ON "EventReferente"("eventPersonId");
CREATE UNIQUE INDEX "EventReferente_eventId_emailNormalized_key" ON "EventReferente"("eventId", "emailNormalized");
CREATE INDEX "EventReferente_eventId_name_idx" ON "EventReferente"("eventId", "name");
CREATE INDEX "EventPerson_referenteId_idx" ON "EventPerson"("referenteId");

ALTER TABLE "EventReferente" ADD CONSTRAINT "EventReferente_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventReferente" ADD CONSTRAINT "EventReferente_eventPersonId_fkey" FOREIGN KEY ("eventPersonId") REFERENCES "EventPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EventPerson" ADD CONSTRAINT "EventPerson_referenteId_fkey" FOREIGN KEY ("referenteId") REFERENCES "EventReferente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
