-- CreateEnum
CREATE TYPE "EventKind" AS ENUM ('gcba', 'vecinos');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'ADMIN_VECINOS';

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "kind" "EventKind" NOT NULL DEFAULT 'gcba';

-- AlterTable
ALTER TABLE "Person" ADD COLUMN "address" TEXT,
ADD COLUMN "comuna" TEXT;

-- CreateIndex
CREATE INDEX "Person_dni_idx" ON "Person"("dni");

-- CreateTable
CREATE TABLE "VecinoDirectoryPerson" (
    "id" TEXT NOT NULL,
    "dni" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "address" TEXT,
    "comuna" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "participationCount" INTEGER,
    "claimCount" INTEGER,
    "codV" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VecinoDirectoryPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VecinoDirectoryUpload" (
    "id" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VecinoDirectoryUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VecinoDirectoryPerson_dni_key" ON "VecinoDirectoryPerson"("dni");

-- CreateIndex
CREATE INDEX "VecinoDirectoryPerson_lastName_firstName_idx" ON "VecinoDirectoryPerson"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "VecinoDirectoryPerson_comuna_idx" ON "VecinoDirectoryPerson"("comuna");

-- AddForeignKey
ALTER TABLE "VecinoDirectoryUpload" ADD CONSTRAINT "VecinoDirectoryUpload_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
