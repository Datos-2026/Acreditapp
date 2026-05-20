-- CreateTable
CREATE TABLE "DirectoryPerson" (
    "id" TEXT NOT NULL,
    "cuilNormalized" TEXT NOT NULL,
    "dni" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "ministerio" TEXT,
    "litPuesto" TEXT,
    "descRep" TEXT,
    "emailLaboral" TEXT,
    "emailPersonal" TEXT,
    "emailMia" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectoryPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectoryUpload" (
    "id" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectoryUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DirectoryPerson_cuilNormalized_key" ON "DirectoryPerson"("cuilNormalized");

-- CreateIndex
CREATE INDEX "DirectoryPerson_dni_idx" ON "DirectoryPerson"("dni");

-- CreateIndex
CREATE INDEX "DirectoryPerson_lastName_firstName_idx" ON "DirectoryPerson"("lastName", "firstName");

-- AddForeignKey
ALTER TABLE "DirectoryUpload" ADD CONSTRAINT "DirectoryUpload_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
