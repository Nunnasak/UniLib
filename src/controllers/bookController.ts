import type { Request, Response } from "express";

import { prisma } from "../config/db.ts";
import {
  addCalendarDays,
  calculateLateFine,
  getBusinessDate,
  toDateOnly,
} from "../utils/businessDate.ts";

type BookParams = { bookId: string };
type LoanParams = { loanId: string };

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

const isRetryableTransactionError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "P2034";

export const borrowBook = async (
  req: Request<BookParams>,
  res: Response,
): Promise<void> => {
  const borrower = req.user;
  if (!borrower) {
    res.status(401).json({ error: "Not authorized" });
    return;
  }
  if (borrower.accountStatus === "DISABLED") {
    res.status(403).json({ error: "Account is disabled" });
    return;
  }
  if (borrower.role !== "STUDENT" && borrower.role !== "LECTURER") {
    res.status(403).json({ error: "Only students and lecturers can borrow books" });
    return;
  }
  if (!hasCopyId(req.body)) {
    res.status(400).json({ error: "copyId is required" });
    return;
  }

  const { bookId } = req.params;
  const copyId = req.body.copyId.trim();
  const now = new Date();
  const borrowedOn = getBusinessDate(now);
  const dueOn = addCalendarDays(borrowedOn, STANDARD_LOAN_DAYS);

  try {
    const loan = await prisma.$transaction(async (tx) => {
      const [book, copy, activeLoanCount, sameBookLoan] = await Promise.all([
        tx.book.findUnique({ where: { id: bookId }, select: { id: true, isActive: true } }),
        tx.bookCopy.findUnique({
          where: { id: copyId },
          select: { id: true, bookId: true, status: true },
        }),
        tx.loan.count({ where: { borrowerId: borrower.id, status: "ACTIVE" } }),
        tx.loan.findFirst({
          where: { borrowerId: borrower.id, bookId, status: "ACTIVE" },
          select: { id: true },
        }),
      ]);

      if (!book || !book.isActive) throw new Error("BOOK_NOT_FOUND");
      if (!copy || copy.bookId !== bookId) throw new Error("COPY_NOT_FOUND");
      if (activeLoanCount >= ACTIVE_LOAN_LIMIT) throw new Error("ACTIVE_LOAN_LIMIT");
      if (sameBookLoan) throw new Error("DUPLICATE_BOOK_LOAN");
      if (copy.status !== "AVAILABLE") throw new Error("COPY_NOT_AVAILABLE");

      const claimed = await tx.bookCopy.updateMany({
        where: { id: copyId, bookId, status: "AVAILABLE" },
        data: { status: "ON_LOAN" },
      });
      if (claimed.count !== 1) throw new Error("COPY_NOT_AVAILABLE");

      return tx.loan.create({
        data: {
          borrowerId: borrower.id,
          bookId,
          copyId,
          checkedOutById: borrower.id,
          borrowedAt: now,
          borrowedOn,
          dueOn,
        },
      });
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
      COPY_NOT_FOUND: [404, "Copy not found for this book"],
      ACTIVE_LOAN_LIMIT: [409, "A borrower may have at most 5 active loans"],
      DUPLICATE_BOOK_LOAN: [409, "Borrower already has an active loan for this book"],
      COPY_NOT_AVAILABLE: [409, "Copy is not available"],
    };
    const mapped = error instanceof Error ? messages[error.message] : undefined;
    if (mapped) {
      res.status(mapped[0]).json({ error: mapped[1] });
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
      if (!current || current.borrowerId !== actor.id) throw new Error("LOAN_NOT_FOUND");
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
            status: "QUEUED",
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
      res.status(mapped[0]).json({ error: mapped[1] });
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
  const now = new Date();
  const closedOn = getBusinessDate(now);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.loan.findUnique({ where: { id: req.params.loanId } });
      const canClose =
        current &&
        (current.borrowerId === actor.id || actor.role === "LIBRARIAN" || actor.role === "ADMIN");
      if (!current || !canClose) throw new Error("LOAN_NOT_FOUND");
      if (current.status !== "ACTIVE") throw new Error("LOAN_NOT_ACTIVE");

      const lateFine = calculateLateFine(current.dueOn, now);
      const closed = await tx.loan.updateMany({
        where: { id: current.id, status: "ACTIVE" },
        data: {
          status: "RETURNED",
          closedAt: now,
          closedOn,
          closedById: actor.id,
          returnCondition: "NORMAL",
        },
      });
      if (closed.count !== 1) throw new Error("LOAN_CHANGED");

      await tx.bookCopy.update({
        where: { id: current.copyId },
        data: { status: "AVAILABLE" },
      });

      if (lateFine > 0) {
        const account = await tx.financialAccount.upsert({
          where: { borrowerId: current.borrowerId },
          create: { borrowerId: current.borrowerId, outstandingBalance: lateFine },
          update: { outstandingBalance: { increment: lateFine } },
        });
        await tx.financialTransaction.create({
          data: {
            accountId: account.id,
            createdById: actor.id,
            type: "RETURN_CHARGE",
            sourceKey: `loan:${current.id}:late-fine`,
            reason: "Late return fine",
            entries: {
              create: {
                loanId: current.id,
                component: "LATE_FINE",
                direction: "DEBIT",
                amount: lateFine,
              },
            },
          },
        });
      }

      return { ...current, status: "RETURNED" as const, closedAt: now, closedOn, lateFine };
    }, { isolationLevel: "Serializable" });

    res.status(200).json({
      message: "Book returned successfully",
      data: {
        ...result,
        borrowedOn: toDateOnly(result.borrowedOn),
        dueOn: toDateOnly(result.dueOn),
        closedOn: toDateOnly(result.closedOn),
        accruedLateFine: result.lateFine,
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
      res.status(mapped[0]).json({ error: mapped[1] });
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
  const loan = await prisma.loan.findUnique({ where: { id: req.params.loanId } });
  const canView =
    loan &&
    (loan.borrowerId === actor.id || actor.role === "LIBRARIAN" || actor.role === "ADMIN");
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
