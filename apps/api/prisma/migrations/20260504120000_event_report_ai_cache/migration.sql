-- CreateTable
CREATE TABLE "EventReportAiCache" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "analysis" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventReportAiCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventReportAiCache_eventId_key" ON "EventReportAiCache"("eventId");

-- AddForeignKey
ALTER TABLE "EventReportAiCache" ADD CONSTRAINT "EventReportAiCache_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
