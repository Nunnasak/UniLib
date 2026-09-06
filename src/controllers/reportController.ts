import type { Request, Response } from "express";

import { prisma } from "../config/db.ts";
import { calculateLateFine, getBusinessDate, toDateOnly } from "../utils/businessDate.ts";

const pageOptions = (req: Request, defaultLimit = 20) => {
  const rawPage = typeof req.query.page === "string" ? Number(req.query.page) : 1;
  const rawLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : defaultLimit;
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Math.min(Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : defaultLimit, 100);
  return { page, limit };
};

export const overdueReport = async (req: Request, res: Response): Promise<void> => {
  const actor = req.user;
  if (!actor || actor.role !== "LIBRARIAN") {
    res.status(actor ? 403 : 401).json({ error: actor ? "Librarian permission required" : "Not authorized" });
    return;
  }
  const { page, limit } = pageOptions(req);
  const today = getBusinessDate();
  const where = { status: "ACTIVE" as const, dueOn: { lt: today } };
  const [total, loans] = await prisma.$transaction([
    prisma.loan.count({ where }),
    prisma.loan.findMany({
      where,
      include: {
        borrower: { select: { id: true, universityId: true, fullName: true, email: true } },
        book: { select: { id: true, isbn13: true, title: true } },
        copy: { select: { id: true, barcode: true } },
      },
      orderBy: [{ dueOn: "asc" }, { id: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  res.status(200).json({
    data: loans.map((loan) => ({
      ...loan,
      dueOn: toDateOnly(loan.dueOn),
      accruedLateFine: calculateLateFine(loan.dueOn),
    })),
    asOf: toDateOnly(today),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
};

export const inventoryReport = async (req: Request, res: Response): Promise<void> => {
  const actor = req.user;
  if (!actor || actor.role !== "LIBRARIAN") {
    res.status(actor ? 403 : 401).json({ error: actor ? "Librarian permission required" : "Not authorized" });
    return;
  }
  const { page, limit } = pageOptions(req);
  const requestedStatus = typeof req.query.status === "string" ? req.query.status : undefined;
  const statuses = ["AVAILABLE", "ON_LOAN", "ON_HOLD", "MAINTENANCE", "LOST", "RETIRED"] as const;
  if (requestedStatus && !statuses.includes(requestedStatus as (typeof statuses)[number])) {
    res.status(400).json({ error: "Invalid inventory status" });
    return;
  }
  const where = requestedStatus ? { status: requestedStatus as (typeof statuses)[number] } : {};
  const [total, copies, summary] = await prisma.$transaction([
    prisma.bookCopy.count({ where }),
    prisma.bookCopy.findMany({
      where,
      include: { book: { select: { id: true, isbn13: true, title: true } } },
      orderBy: [{ status: "asc" }, { barcode: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.bookCopy.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  res.status(200).json({
    data: copies,
    summary: Object.fromEntries(summary.map((item) => [item.status, item._count._all])),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
};

export const systemSummaryReport = async (req: Request, res: Response): Promise<void> => {
  const actor = req.user;
  if (!actor || actor.role !== "ADMIN") {
    res.status(actor ? 403 : 401).json({ error: actor ? "Administrator permission required" : "Not authorized" });
    return;
  }
  const [users, books, copies, loansByStatus, reservationsByStatus, balances, transactionsByType] =
    await prisma.$transaction([
      prisma.user.count(),
      prisma.book.count({ where: { isActive: true } }),
      prisma.bookCopy.count(),
      prisma.loan.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.reservation.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.financialAccount.aggregate({
        _sum: { outstandingBalance: true },
        _count: { _all: true },
      }),
      prisma.financialTransaction.groupBy({ by: ["type"], _count: { _all: true } }),
    ]);
  res.status(200).json({
    data: {
      users,
      activeBooks: books,
      physicalCopies: copies,
      loans: Object.fromEntries(loansByStatus.map((item) => [item.status, item._count._all])),
      reservations: Object.fromEntries(reservationsByStatus.map((item) => [item.status, item._count._all])),
      financialAccounts: balances._count._all,
      totalOutstandingBalance: balances._sum.outstandingBalance ?? 0,
      financialTransactions: Object.fromEntries(
        transactionsByType.map((item) => [item.type, item._count._all]),
      ),
    },
  });
};
