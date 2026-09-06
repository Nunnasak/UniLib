-- Rename the legacy singular user table to match @@map("users").
-- PostgreSQL preserves all data and updates foreign-key references on rename.
ALTER TABLE "User" RENAME TO "users";

-- Keep Prisma's default constraint and index names aligned with the physical table.
ALTER TABLE "users" RENAME CONSTRAINT "User_pkey" TO "users_pkey";
ALTER INDEX "User_universityId_key" RENAME TO "users_universityId_key";
ALTER INDEX "User_email_key" RENAME TO "users_email_key";
ALTER INDEX "User_role_accountStatus_idx" RENAME TO "users_role_accountStatus_idx";
