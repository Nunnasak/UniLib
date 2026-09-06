/*
  Warnings:

  - You are about to drop the `Book` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `BorrowRecord` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "CopyStatus" AS ENUM ('AVAILABLE', 'ON_LOAN', 'ON_HOLD', 'MAINTENANCE', 'LOST', 'RETIRED');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('ACTIVE', 'RETURNED', 'LOST');

-- CreateEnum
CREATE TYPE "ReturnCondition" AS ENUM ('NORMAL', 'MINOR_DAMAGE', 'MAJOR_DAMAGE', 'UNUSABLE');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('QUEUED', 'HELD', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FinancialTransactionType" AS ENUM ('RETURN_CHARGE', 'LOST_CHARGE', 'PAYMENT', 'WAIVER', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "LedgerComponent" AS ENUM ('LATE_FINE', 'LOST_REPLACEMENT', 'PROCESSING_FEE', 'DAMAGE_CHARGE', 'PAYMENT', 'WAIVER', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILED');

-- DropForeignKey
ALTER TABLE "BorrowRecord" DROP CONSTRAINT "BorrowRecord_bookId_fkey";

-- DropForeignKey
ALTER TABLE "BorrowRecord" DROP CONSTRAINT "BorrowRecord_userId_fkey";

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "id" SET DATA TYPE UUID USING ("id"::uuid);

-- DropTable
DROP TABLE "Book";

-- DropTable
DROP TABLE "BorrowRecord";

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshTokenHash" VARCHAR(255) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "lastUsedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "books" (
    "id" UUID NOT NULL,
    "isbn13" VARCHAR(13) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "publisher" VARCHAR(255) NOT NULL,
    "publicationYear" INTEGER NOT NULL,
    "languageCode" VARCHAR(10) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authors" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "authors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_authors" (
    "bookId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "book_authors_pkey" PRIMARY KEY ("bookId","authorId")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_categories" (
    "bookId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,

    CONSTRAINT "book_categories_pkey" PRIMARY KEY ("bookId","categoryId")
);

-- CreateTable
CREATE TABLE "book_copies" (
    "id" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "barcode" VARCHAR(100) NOT NULL,
    "acquisitionPrice" DECIMAL(12,2) NOT NULL,
    "acquisitionDate" DATE NOT NULL,
    "status" "CopyStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "book_copies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loans" (
    "id" UUID NOT NULL,
    "borrowerId" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "copyId" UUID NOT NULL,
    "checkedOutById" UUID NOT NULL,
    "closedById" UUID,
    "status" "LoanStatus" NOT NULL DEFAULT 'ACTIVE',
    "borrowedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "borrowedOn" DATE NOT NULL,
    "dueOn" DATE NOT NULL,
    "closedAt" TIMESTAMPTZ(3),
    "closedOn" DATE,
    "returnCondition" "ReturnCondition",
    "renewalCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_renewals" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "renewedById" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "previousDueOn" DATE NOT NULL,
    "newDueOn" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_renewals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" UUID NOT NULL,
    "borrowerId" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "allocatedCopyId" UUID,
    "status" "ReservationStatus" NOT NULL DEFAULT 'QUEUED',
    "allocatedAt" TIMESTAMPTZ(3),
    "holdExpiresAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "expiredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_accounts" (
    "id" UUID NOT NULL,
    "borrowerId" UUID NOT NULL,
    "outstandingBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_transactions" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "createdById" UUID,
    "type" "FinancialTransactionType" NOT NULL,
    "sourceKey" VARCHAR(255) NOT NULL,
    "reason" TEXT,
    "externalReference" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_entries" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "loanId" UUID,
    "component" "LedgerComponent" NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_requests" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "operation" VARCHAR(100) NOT NULL,
    "idempotencyKey" VARCHAR(255) NOT NULL,
    "requestHash" VARCHAR(128) NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'PROCESSING',
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "resourceId" VARCHAR(255),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" VARCHAR(100) NOT NULL,
    "resourceType" VARCHAR(100) NOT NULL,
    "resourceId" VARCHAR(255) NOT NULL,
    "outcome" "AuditOutcome" NOT NULL,
    "requestId" VARCHAR(255),
    "beforeData" JSONB,
    "afterData" JSONB,
    "metadata" JSONB,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_refreshTokenHash_key" ON "auth_sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "auth_sessions_userId_expiresAt_idx" ON "auth_sessions"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "books_isbn13_key" ON "books"("isbn13");

-- CreateIndex
CREATE INDEX "books_title_idx" ON "books"("title");

-- CreateIndex
CREATE INDEX "books_isActive_idx" ON "books"("isActive");

-- CreateIndex
CREATE INDEX "authors_name_idx" ON "authors"("name");

-- CreateIndex
CREATE INDEX "book_authors_authorId_bookId_idx" ON "book_authors"("authorId", "bookId");

-- CreateIndex
CREATE UNIQUE INDEX "book_authors_bookId_position_key" ON "book_authors"("bookId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE INDEX "book_categories_categoryId_bookId_idx" ON "book_categories"("categoryId", "bookId");

-- CreateIndex
CREATE UNIQUE INDEX "book_copies_barcode_key" ON "book_copies"("barcode");

-- CreateIndex
CREATE INDEX "book_copies_bookId_status_idx" ON "book_copies"("bookId", "status");

-- CreateIndex
CREATE INDEX "book_copies_status_idx" ON "book_copies"("status");

-- CreateIndex
CREATE UNIQUE INDEX "book_copies_id_bookId_key" ON "book_copies"("id", "bookId");

-- CreateIndex
CREATE INDEX "loans_borrowerId_status_dueOn_idx" ON "loans"("borrowerId", "status", "dueOn");

-- CreateIndex
CREATE INDEX "loans_status_dueOn_idx" ON "loans"("status", "dueOn");

-- CreateIndex
CREATE INDEX "loans_bookId_status_idx" ON "loans"("bookId", "status");

-- CreateIndex
CREATE INDEX "loans_copyId_status_idx" ON "loans"("copyId", "status");

-- CreateIndex
CREATE INDEX "loan_renewals_renewedById_createdAt_idx" ON "loan_renewals"("renewedById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "loan_renewals_loanId_sequence_key" ON "loan_renewals"("loanId", "sequence");

-- CreateIndex
CREATE INDEX "reservations_bookId_status_createdAt_id_idx" ON "reservations"("bookId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "reservations_borrowerId_status_idx" ON "reservations"("borrowerId", "status");

-- CreateIndex
CREATE INDEX "reservations_status_holdExpiresAt_idx" ON "reservations"("status", "holdExpiresAt");

-- CreateIndex
CREATE INDEX "reservations_allocatedCopyId_status_idx" ON "reservations"("allocatedCopyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_borrowerId_key" ON "financial_accounts"("borrowerId");

-- CreateIndex
CREATE INDEX "financial_accounts_outstandingBalance_idx" ON "financial_accounts"("outstandingBalance");

-- CreateIndex
CREATE UNIQUE INDEX "financial_transactions_sourceKey_key" ON "financial_transactions"("sourceKey");

-- CreateIndex
CREATE INDEX "financial_transactions_accountId_createdAt_idx" ON "financial_transactions"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "financial_transactions_createdById_createdAt_idx" ON "financial_transactions"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "financial_entries_transactionId_idx" ON "financial_entries"("transactionId");

-- CreateIndex
CREATE INDEX "financial_entries_loanId_component_idx" ON "financial_entries"("loanId", "component");

-- CreateIndex
CREATE INDEX "idempotency_requests_expiresAt_idx" ON "idempotency_requests"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_requests_actorId_operation_idempotencyKey_key" ON "idempotency_requests"("actorId", "operation", "idempotencyKey");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_occurredAt_idx" ON "audit_logs"("actorId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_logs_resourceType_resourceId_occurredAt_idx" ON "audit_logs"("resourceType", "resourceId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_occurredAt_idx" ON "audit_logs"("action", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_logs_requestId_idx" ON "audit_logs"("requestId");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_authors" ADD CONSTRAINT "book_authors_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_authors" ADD CONSTRAINT "book_authors_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "authors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_categories" ADD CONSTRAINT "book_categories_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_categories" ADD CONSTRAINT "book_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_copies" ADD CONSTRAINT "book_copies_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_checkedOutById_fkey" FOREIGN KEY ("checkedOutById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_copyId_bookId_fkey" FOREIGN KEY ("copyId", "bookId") REFERENCES "book_copies"("id", "bookId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_renewals" ADD CONSTRAINT "loan_renewals_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_renewals" ADD CONSTRAINT "loan_renewals_renewedById_fkey" FOREIGN KEY ("renewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_allocatedCopyId_bookId_fkey" FOREIGN KEY ("allocatedCopyId", "bookId") REFERENCES "book_copies"("id", "bookId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "financial_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_requests" ADD CONSTRAINT "idempotency_requests_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
