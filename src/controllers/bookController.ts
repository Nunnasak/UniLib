import type { Request, Response } from "express";

import { prisma } from "../config/db.ts";
import {
  allocateCopyToNextReservation,
  processExpiredReservationHolds,
} from "../services/reservationService.ts";
import {
  addCalendarDays,
  calculateLateFine,
  getBusinessDate,
  toDateOnly,
} from "../utils/businessDate.ts";
import { calculateDamageCharges, roundMoney } from "../utils/money.ts";

type BookParams = { bookId: string };
type LoanParams = { loanId: string };
type ReturnCondition = "NORMAL" | "MINOR_DAMAGE" | "MAJOR_DAMAGE" | "UNUSABLE";

const ACTIVE_LOAN_LIMIT = 5;
const STANDARD_LOAN_DAYS = 14;
const MAX_RENEWALS = 2;
const RENEWAL_DAYS = 7;
const RENEWAL_FINE_LIMIT = 500;

const hasCopyId = (body: unknown): body is { copyId: string } => {
  if (typeof body !== "object" || body === null) return false;
  const copyId = (body as Record<string, unknown>).copyId;
  return typeof copyId === "string" && copyId.trim().length > 0;
};

const getReturnCondition = (body: unknown): ReturnCondition | null => {
  if (typeof body !== "object" || body === null) return null;
  const candidate = body as Record<string, unknown>;
  const condition = candidate.returnCondition ?? candidate.condition;
  return condition === "NORMAL" ||
    condition === "MINOR_DAMAGE" ||
    condition === "MAJOR_DAMAGE" ||
    condition === "UNUSABLE"
    ? condition
    : null;
};

const isRetryableTransactionError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "P2034";

export const borrowBook = async (
  req: Request<BookParams>,
  res: Response,
): Promise<void> => {
  const actor = req.user;
  if (!actor) {
    res.status(401).json({ error: "Not authorized" });
    return;
  }
  const actorIsBorrower = actor.role === "STUDENT" || actor.role === "LECTURER";
  const actorIsLibrarian = actor.role === "LIBRARIAN";
  if (!actorIsBorrower && !actorIsLibrarian) {
    res.status(403).json({ error: "Borrowing requires borrower or librarian permission" });
    return;
  }
  if (!hasCopyId(req.body)) {
    res.status(400).json({ error: "copyId is required" });
    return;
  }

  const { bookId } = req.params;
  const copyId = req.body.copyId.trim();
  const requestedBorrowerId =
    typeof req.body === "object" && req.body !== null &&
    typeof (req.body as Record<string, unknown>).borrowerId === "string"
      ? (req.body as Record<string, unknown>).borrowerId as string
      : undefined;
  const borrowerId = actorIsBorrower ? actor.id : requestedBorrowerId?.trim();
  if (!borrowerId) {
    res.status(400).json({ error: "borrowerId is required for librarian checkout" });
    return;
  }
  const now = new Date();
  const borrowedOn = getBusinessDate(now);
  const dueOn = addCalendarDays(borrowedOn, STANDARD_LOAN_DAYS);

  await processExpiredReservationHolds(now);

  try {
    const loan = await prisma.$transaction(async (tx) => {
      const [borrower, book, copy, activeLoanCount, sameBookLoan, overdueLoan, account, heldReservation] = await Promise.all([
        tx.user.findUnique({
          where: { id: borrowerId },
          select: { id: true, role: true, accountStatus: true },
        }),
        tx.book.findUnique({ where: { id: bookId }, select: { id: true, isActive: true } }),
        tx.bookCopy.findUnique({
          where: { id: copyId },
          select: { id: true, bookId: true, status: true },
        }),
        tx.loan.count({ where: { borrowerId, status: "ACTIVE" } }),
        tx.loan.findFirst({
          where: { borrowerId, bookId, status: "ACTIVE" },
          select: { id: true },
        }),
        tx.loan.findFirst({
          where: { borrowerId, status: "ACTIVE", dueOn: { lt: borrowedOn } },
          select: { id: true },
        }),
        tx.financialAccount.findUnique({
          where: { borrowerId },
          select: { outstandingBalance: true },
        }),
        tx.reservation.findFirst({
          where: {
            borrowerId,
            bookId,
            allocatedCopyId: copyId,
            status: "HELD",
            holdExpiresAt: { gt: now },
          },
        }),
      ]);

      if (!borrower || (borrower.role !== "STUDENT" && borrower.role !== "LECTURER")) {
        throw new Error("BORROWER_NOT_FOUND");
      }
      if (borrower.accountStatus === "DISABLED") throw new Error("ACCOUNT_DISABLED");
      if (!book || !book.isActive) throw new Error("BOOK_NOT_FOUND");
      if (!copy || copy.bookId !== bookId) throw new Error("COPY_NOT_FOUND");
      if (activeLoanCount >= ACTIVE_LOAN_LIMIT) throw new Error("ACTIVE_LOAN_LIMIT");
      if (sameBookLoan) throw new Error("DUPLICATE_BOOK_LOAN");
      if (overdueLoan) throw new Error("OVERDUE_LOAN");
      if (Number(account?.outstandingBalance ?? 0) >= RENEWAL_FINE_LIMIT) {
        throw new Error("OUTSTANDING_FINE");
      }

      const isAvailable = copy.status === "AVAILABLE";
      const isHeldForBorrower = copy.status === "ON_HOLD" && heldReservation !== null;
      if (!isAvailable && !isHeldForBorrower) throw new Error("COPY_NOT_AVAILABLE");

      const claimed = await tx.bookCopy.updateMany({
        where: { id: copyId, bookId, status: isAvailable ? "AVAILABLE" : "ON_HOLD" },
        data: { status: "ON_LOAN" },
      });
      if (claimed.count !== 1) throw new Error("COPY_NOT_AVAILABLE");

      if (heldReservation) {
        const completed = await tx.reservation.updateMany({
          where: { id: heldReservation.id, status: "HELD", allocatedCopyId: copyId },
          data: { status: "COMPLETED", completedAt: now },
        });
        if (completed.count !== 1) throw new Error("RESERVATION_CHANGED");
      }

      const loan = await tx.loan.create({
        data: {
          borrowerId,
          bookId,
          copyId,
          checkedOutById: actor.id,
          borrowedAt: now,
          borrowedOn,
          dueOn,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "LOAN_CREATED",
          resourceType: "Loan",
          resourceId: loan.id,
          outcome: "SUCCESS",
          afterData: {
            borrowerId,
            bookId,
            copyId,
            borrowedOn: toDateOnly(borrowedOn),
            dueOn: toDateOnly(dueOn),
          },
        },
      });
      return loan;
    }, { isolationLevel: "Serializable" });

    res.status(201).json({
      message: "Book borrowed successfully",
      data: {
        ...loan,
        borrowedOn: toDateOnly(loan.borrowedOn),
        dueOn: toDateOnly(loan.dueOn),
        accruedLateFine: 0,
      },
    });
  } catch (error) {
    const messages: Record<string, [number, string]> = {
      BOOK_NOT_FOUND: [404, "Book not found"],
      BORROWER_NOT_FOUND: [404, "Borrower not found"],
      ACCOUNT_DISABLED: [403, "Borrower account is disabled"],
      COPY_NOT_FOUND: [404, "Copy not found for this book"],
      ACTIVE_LOAN_LIMIT: [409, "A borrower may have at most 5 active loans"],
      DUPLICATE_BOOK_LOAN: [409, "Borrower already has an active loan for this book"],
      OVERDUE_LOAN: [409, "An overdue loan prevents new borrowing"],
      OUTSTANDING_FINE: [409, "Outstanding balance of 500 baht or more prevents borrowing"],
      COPY_NOT_AVAILABLE: [409, "Copy is not available"],
      RESERVATION_CHANGED: [409, "Reservation state changed; please retry"],
    };
    const mapped = error instanceof Error ? messages[error.message] : undefined;
    if (mapped) {
      res.status(mapped[0]).json({ code: (error as Error).message, error: mapped[1] });
      return;
    }
    if (isRetryableTransactionError(error)) {
      res.status(409).json({ error: "Loan state changed; please retry" });
      return;
    }
    throw error;
  }
};

export const renewLoan = async (
  req: Request<LoanParams>,
  res: Response,
): Promise<void> => {
  const actor = req.user;
  if (!actor) {
    res.status(401).json({ error: "Not authorized" });
    return;
  }
  if (actor.role === "ADMIN") {
    res.status(403).json({ error: "Administrators do not have circulation permission" });
    return;
  }
  const today = getBusinessDate();

  try {
    const loan = await prisma.$transaction(async (tx) => {
      const current = await tx.loan.findUnique({
        where: { id: req.params.loanId },
        include: {
          borrower: {
            select: {
              id: true,
              accountStatus: true,
              financialAccount: { select: { outstandingBalance: true } },
            },
          },
        },
      });
      const mayRenew =
        current &&
        (actor.role === "LIBRARIAN" || current.borrowerId === actor.id);
      if (!current || !mayRenew) throw new Error("LOAN_NOT_FOUND");
      if (current.status !== "ACTIVE") throw new Error("LOAN_NOT_ACTIVE");
      if (current.dueOn.getTime() < today.getTime()) throw new Error("LOAN_OVERDUE");
      if (current.renewalCount >= MAX_RENEWALS) throw new Error("RENEWAL_LIMIT");
      if (current.borrower.accountStatus === "DISABLED") throw new Error("ACCOUNT_DISABLED");
      if (Number(current.borrower.financialAccount?.outstandingBalance ?? 0) >= RENEWAL_FINE_LIMIT) {
        throw new Error("OUTSTANDING_FINE");
      }

      const [otherReservation, otherOverdueLoan] = await Promise.all([
        tx.reservation.findFirst({
          where: {
            bookId: current.bookId,
            status: { in: ["QUEUED", "HELD"] },
            borrowerId: { not: current.borrowerId },
          },
          select: { id: true },
        }),
        tx.loan.findFirst({
          where: {
            borrowerId: current.borrowerId,
            status: "ACTIVE",
            dueOn: { lt: today },
            id: { not: current.id },
          },
          select: { id: true },
        }),
      ]);
      if (otherReservation) throw new Error("RESERVATION_QUEUE");
      if (otherOverdueLoan) throw new Error("OTHER_OVERDUE_LOAN");

      const previousDueOn = current.dueOn;
      const newDueOn = addCalendarDays(previousDueOn, RENEWAL_DAYS);
      const sequence = current.renewalCount + 1;
      const updated = await tx.loan.updateMany({
        where: { id: current.id, status: "ACTIVE", renewalCount: current.renewalCount },
        data: { dueOn: newDueOn, renewalCount: sequence },
      });
      if (updated.count !== 1) throw new Error("LOAN_CHANGED");

      await tx.loanRenewal.create({
        data: {
          loanId: current.id,
          renewedById: actor.id,
          sequence,
          previousDueOn,
          newDueOn,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "LOAN_RENEWED",
          resourceType: "Loan",
          resourceId: current.id,
          outcome: "SUCCESS",
          beforeData: { dueOn: toDateOnly(previousDueOn), renewalCount: current.renewalCount },
          afterData: { dueOn: toDateOnly(newDueOn), renewalCount: sequence },
        },
      });
      return { id: current.id, dueOn: newDueOn, renewalCount: sequence };
    }, { isolationLevel: "Serializable" });

    res.status(200).json({
      message: "Loan renewed successfully",
      data: { ...loan, dueOn: toDateOnly(loan.dueOn) },
    });
  } catch (error) {
    const messages: Record<string, [number, string]> = {
      LOAN_NOT_FOUND: [404, "Loan not found"],
      LOAN_NOT_ACTIVE: [409, "Only active loans can be renewed"],
      LOAN_OVERDUE: [409, "An overdue loan cannot be renewed"],
      RENEWAL_LIMIT: [409, "A loan can be renewed at most 2 times"],
      ACCOUNT_DISABLED: [403, "Account is disabled"],
      OUTSTANDING_FINE: [409, "Outstanding fines of 500 baht or more prevent renewal"],
      RESERVATION_QUEUE: [409, "Another borrower is waiting for this book"],
      OTHER_OVERDUE_LOAN: [409, "Another active loan is overdue"],
      LOAN_CHANGED: [409, "Loan state changed; please retry"],
    };
    const mapped = error instanceof Error ? messages[error.message] : undefined;
    if (mapped) {
      res.status(mapped[0]).json({ code: (error as Error).message, error: mapped[1] });
      return;
    }
    if (isRetryableTransactionError(error)) {
      res.status(409).json({ error: "Loan state changed; please retry" });
      return;
    }
    throw error;
  }
};

export const returnLoan = async (
  req: Request<LoanParams>,
  res: Response,
): Promise<void> => {
  const actor = req.user;
  if (!actor) {
    res.status(401).json({ error: "Not authorized" });
    return;
  }
  if (actor.role !== "LIBRARIAN") {
    res.status(403).json({ error: "Only a librarian can process a return" });
    return;
  }
  const returnCondition = getReturnCondition(req.body);
  if (!returnCondition) {
    res.status(400).json({
      error: "condition must be NORMAL, MINOR_DAMAGE, MAJOR_DAMAGE, or UNUSABLE",
    });
    return;
  }
  const now = new Date();
  const closedOn = getBusinessDate(now);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.loan.findUnique({
        where: { id: req.params.loanId },
        include: { copy: { select: { acquisitionPrice: true } } },
      });
      if (!current) throw new Error("LOAN_NOT_FOUND");
      if (current.status !== "ACTIVE") throw new Error("LOAN_NOT_ACTIVE");

      const lateFine = calculateLateFine(current.dueOn, now);
      const { damageCharge, processingFee } = calculateDamageCharges(
        Number(current.copy.acquisitionPrice),
        returnCondition,
      );
      const totalCharge = roundMoney(lateFine + damageCharge + processingFee);
      const closed = await tx.loan.updateMany({
        where: { id: current.id, status: "ACTIVE" },
        data: {
          status: "RETURNED",
          closedAt: now,
          closedOn,
          closedById: actor.id,
          returnCondition,
        },
      });
      if (closed.count !== 1) throw new Error("LOAN_CHANGED");

      if (returnCondition === "NORMAL") {
        await allocateCopyToNextReservation(tx, current.bookId, current.copyId, now);
      } else {
        await tx.bookCopy.update({
          where: { id: current.copyId },
          data: { status: returnCondition === "UNUSABLE" ? "RETIRED" : "MAINTENANCE" },
        });
      }

      if (totalCharge > 0) {
        const account = await tx.financialAccount.upsert({
          where: { borrowerId: current.borrowerId },
          create: { borrowerId: current.borrowerId, outstandingBalance: totalCharge },
          update: { outstandingBalance: { increment: totalCharge } },
        });
        const entries = [
          ...(lateFine > 0
            ? [{ loanId: current.id, component: "LATE_FINE" as const, direction: "DEBIT" as const, amount: lateFine }]
            : []),
          ...(damageCharge > 0
            ? [{ loanId: current.id, component: "DAMAGE_CHARGE" as const, direction: "DEBIT" as const, amount: damageCharge }]
            : []),
          ...(processingFee > 0
            ? [{ loanId: current.id, component: "PROCESSING_FEE" as const, direction: "DEBIT" as const, amount: processingFee }]
            : []),
        ];
        await tx.financialTransaction.create({
          data: {
            accountId: account.id,
            createdById: actor.id,
            type: "RETURN_CHARGE",
            sourceKey: `loan:${current.id}:return-charge`,
            reason: `Return charge (${returnCondition})`,
            entries: { create: entries },
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "LOAN_RETURNED",
          resourceType: "Loan",
          resourceId: current.id,
          outcome: "SUCCESS",
          beforeData: { status: current.status, copyStatus: "ON_LOAN" },
          afterData: {
            status: "RETURNED",
            returnCondition,
            lateFine,
            damageCharge,
            processingFee,
            totalCharge,
          },
        },
      });
      if (returnCondition !== "NORMAL") {
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: "DAMAGE_ASSESSED",
            resourceType: "Loan",
            resourceId: current.id,
            outcome: "SUCCESS",
            metadata: { returnCondition, damageCharge, processingFee },
          },
        });
      }

      return {
        ...current,
        status: "RETURNED" as const,
        returnCondition,
        closedAt: now,
        closedOn,
        lateFine,
        damageCharge,
        processingFee,
        totalCharge,
      };
    }, { isolationLevel: "Serializable" });

    res.status(200).json({
      message: "Book returned successfully",
      data: {
        ...result,
        borrowedOn: toDateOnly(result.borrowedOn),
        dueOn: toDateOnly(result.dueOn),
        closedOn: toDateOnly(result.closedOn),
        accruedLateFine: result.lateFine,
        charges: {
          lateFine: result.lateFine,
          damageCharge: result.damageCharge,
          processingFee: result.processingFee,
          total: result.totalCharge,
        },
      },
    });
  } catch (error) {
    const messages: Record<string, [number, string]> = {
      LOAN_NOT_FOUND: [404, "Loan not found"],
      LOAN_NOT_ACTIVE: [409, "Loan has already been closed"],
      LOAN_CHANGED: [409, "Loan state changed; please retry"],
    };
    const mapped = error instanceof Error ? messages[error.message] : undefined;
    if (mapped) {
      res.status(mapped[0]).json({ code: (error as Error).message, error: mapped[1] });
      return;
    }
    if (isRetryableTransactionError(error)) {
      res.status(409).json({ error: "Loan state changed; please retry" });
      return;
    }
    throw error;
  }
};

export const confirmLoanLost = async (
  req: Request<LoanParams>,
  res: Response,
): Promise<void> => {
  const actor = req.user;
  if (!actor) {
    res.status(401).json({ error: "Not authorized" });
    return;
  }
  if (actor.role !== "LIBRARIAN") {
    res.status(403).json({ error: "Only a librarian can confirm a lost copy" });
    return;
  }

  const now = new Date();
  const closedOn = getBusinessDate(now);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.loan.findUnique({
        where: { id: req.params.loanId },
        include: { copy: { select: { acquisitionPrice: true } } },
      });
      if (!current) throw new Error("LOAN_NOT_FOUND");
      if (current.status !== "ACTIVE") throw new Error("LOAN_NOT_ACTIVE");

      const lateFine = calculateLateFine(current.dueOn, now);
      const replacementCharge = roundMoney(Number(current.copy.acquisitionPrice));
      const processingFee = 200;
      const totalCharge = roundMoney(replacementCharge + processingFee + lateFine);

      const closed = await tx.loan.updateMany({
        where: { id: current.id, status: "ACTIVE" },
        data: { status: "LOST", closedAt: now, closedOn, closedById: actor.id },
      });
      if (closed.count !== 1) throw new Error("LOAN_CHANGED");
      await tx.bookCopy.update({ where: { id: current.copyId }, data: { status: "LOST" } });

      const account = await tx.financialAccount.upsert({
        where: { borrowerId: current.borrowerId },
        create: { borrowerId: current.borrowerId, outstandingBalance: totalCharge },
        update: { outstandingBalance: { increment: totalCharge } },
      });
      await tx.financialTransaction.create({
        data: {
          accountId: account.id,
          createdById: actor.id,
          type: "LOST_CHARGE",
          sourceKey: `loan:${current.id}:lost-charge`,
          reason: "Lost copy charge",
          entries: {
            create: [
              { loanId: current.id, component: "LOST_REPLACEMENT", direction: "DEBIT", amount: replacementCharge },
              { loanId: current.id, component: "PROCESSING_FEE", direction: "DEBIT", amount: processingFee },
              ...(lateFine > 0
                ? [{ loanId: current.id, component: "LATE_FINE" as const, direction: "DEBIT" as const, amount: lateFine }]
                : []),
            ],
          },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "LOAN_CONFIRMED_LOST",
          resourceType: "Loan",
          resourceId: current.id,
          outcome: "SUCCESS",
          beforeData: { status: current.status, copyStatus: "ON_LOAN" },
          afterData: {
            status: "LOST",
            copyStatus: "LOST",
            replacementCharge,
            processingFee,
            lateFine,
            totalCharge,
          },
        },
      });

      return { id: current.id, closedOn, replacementCharge, processingFee, lateFine, totalCharge };
    }, { isolationLevel: "Serializable" });

    res.status(200).json({
      message: "Lost copy confirmed",
      data: {
        ...result,
        closedOn: toDateOnly(result.closedOn),
        charges: {
          replacementCharge: result.replacementCharge,
          processingFee: result.processingFee,
          lateFine: result.lateFine,
          total: result.totalCharge,
        },
      },
    });
  } catch (error) {
    const messages: Record<string, [number, string]> = {
      LOAN_NOT_FOUND: [404, "Loan not found"],
      LOAN_NOT_ACTIVE: [409, "Loan has already been closed"],
      LOAN_CHANGED: [409, "Loan state changed; please retry"],
    };
    const mapped = error instanceof Error ? messages[error.message] : undefined;
    if (mapped) {
      res.status(mapped[0]).json({ code: (error as Error).message, error: mapped[1] });
      return;
    }
    if (isRetryableTransactionError(error)) {
      res.status(409).json({ error: "Loan state changed; please retry" });
      return;
    }
    throw error;
  }
};

export const getLoan = async (
  req: Request<LoanParams>,
  res: Response,
): Promise<void> => {
  const actor = req.user;
  if (!actor) {
    res.status(401).json({ error: "Not authorized" });
    return;
  }
  const loan = await prisma.loan.findUnique({
    where: { id: req.params.loanId },
    include: { ledgerEntries: true },
  });
  const canView =
    loan &&
    (loan.borrowerId === actor.id || actor.role === "LIBRARIAN");
  if (!loan || !canView) {
    res.status(404).json({ error: "Loan not found" });
    return;
  }

  const accruedLateFine = loan.status === "ACTIVE" ? calculateLateFine(loan.dueOn) : 0;
  res.status(200).json({
    data: {
      ...loan,
      borrowedOn: toDateOnly(loan.borrowedOn),
      dueOn: toDateOnly(loan.dueOn),
      closedOn: loan.closedOn ? toDateOnly(loan.closedOn) : null,
      accruedLateFine,
    },
  });
};

export const listLoans = async (req: Request, res: Response): Promise<void> => {
  const actor = req.user;
  if (!actor) {
    res.status(401).json({ error: "Not authorized" });
    return;
  }
  if (actor.role === "ADMIN") {
    res.status(403).json({ error: "Administrators do not have circulation-record permission" });
    return;
  }
  const pageValue = typeof req.query.page === "string" ? Number(req.query.page) : 1;
  const limitValue = typeof req.query.limit === "string" ? Number(req.query.limit) : 20;
  const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const limit = Math.min(Number.isInteger(limitValue) && limitValue > 0 ? limitValue : 20, 100);
  const status =
    req.query.status === "ACTIVE" || req.query.status === "RETURNED" || req.query.status === "LOST"
      ? req.query.status as "ACTIVE" | "RETURNED" | "LOST"
      : undefined;
  const borrowerId =
    actor.role === "LIBRARIAN" && typeof req.query.borrowerId === "string"
      ? req.query.borrowerId
      : actor.role === "LIBRARIAN"
        ? undefined
        : actor.id;
  const where = {
    ...(borrowerId ? { borrowerId } : {}),
    ...(status ? { status } : {}),
  };
  const [total, loans] = await prisma.$transaction([
    prisma.loan.count({ where }),
    prisma.loan.findMany({
      where,
      include: {
        book: { select: { id: true, isbn13: true, title: true } },
        copy: { select: { id: true, barcode: true, status: true } },
        borrower: { select: { id: true, universityId: true, fullName: true } },
      },
      orderBy: [{ borrowedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  res.status(200).json({
    data: loans.map((loan) => ({
      ...loan,
      borrowedOn: toDateOnly(loan.borrowedOn),
      dueOn: toDateOnly(loan.dueOn),
      closedOn: loan.closedOn ? toDateOnly(loan.closedOn) : null,
      accruedLateFine: loan.status === "ACTIVE" ? calculateLateFine(loan.dueOn) : 0,
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
};
