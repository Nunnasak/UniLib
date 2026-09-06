-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('STUDENT', 'LECTURER', 'LIBRARIAN', 'ADMIN');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- DropIndex
DROP INDEX "User_username_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "username",
ADD COLUMN     "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "email" VARCHAR(320) NOT NULL,
ADD COLUMN     "fullName" VARCHAR(255) NOT NULL,
ADD COLUMN     "role" "UserRole" NOT NULL,
ADD COLUMN     "universityId" VARCHAR(255) NOT NULL,
ADD COLUMN     "updateAt" TIMESTAMPTZ(3) NOT NULL,
ALTER COLUMN "createAt" SET DATA TYPE TIMESTAMPTZ(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_universityId_key" ON "User"("universityId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_accountStatus_idx" ON "User"("role", "accountStatus");
