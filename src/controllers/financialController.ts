import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";

import { prisma } from "../config/db.ts";
import { roundMoney } from "../utils/money.ts";

type BorrowerParams = { borrowerId: string };
type CreditKind = "PAYMENT" | "WAIVER";

const canViewAccount = (
  actor: NonNullable<Request["user"]>,
  borrowerId: string,
): boolean =>
  actor.id === borrowerId || actor.role === "LIBRARIAN" || actor.role === "ADMIN";

const getPositiveAmount = (body: unknown): number | null => {
  if (typeof body !== "object" || body === null) return null;
  const amount = (body as Record<string, unknown>).amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return null;
  return roundMoney(amount);
};

const getOptionalString = (body: unknown, key: string): string | undefined => {
  if (typeof body !== "object" || body === null) return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

export const getFinancialAccount = async (
  req: Request<BorrowerParams>,
  res: Response,
): Promise<void> => {
  const actor = req.user;
  if (!actor) {
    res.status(401).json({ error: "Not authorized" });
    return;
  }
  if (!canViewAccount(actor, req.params.borrowerId)) {
    res.status(403).json({ error: "Not allowed to view this financial account" });
    return;
  }

  const account = await prisma.financialAccount.findUnique({
    where: { borrowerId: req.params.borrowerId },
    include: {
      transactions: {
        include: { entries: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  res.status(200).json({
    data: account ?? {
      borrowerId: req.params.borrowerId,
      outstandingBalance: 0,
      transactions: [],
    },
  });
};

export const listPayments = async (
  req: Request<BorrowerParams>,
  res: Response,
): Promise<void> => {
  const actor = req.user;
  if (!actor) {
    res.status(401).json({ error: "Not authorized" });
    return;
  }
  if (!canViewAccount(actor, req.params.borrowerId)) {
    res.status(403).json({ error: "Not allowed to view these payments" });
    return;
  }

  const rawPage = typeof req.query.page === "string" ? Number(req.query.page) : 1;
  const rawLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : 20;
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Math.min(Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : 20, 100);
  const account = await prisma.financialAccount.findUnique({
    where: { borrowerId: req.params.borrowerId },
    select: { id: true },
  });
  if (!account) {
    res.status(200).json({ data: [], pagination: { page, limit, total: 0, totalPages: 0 } });
    return;
  }

  const where = { accountId: account.id, type: "PAYMENT" as const };
  const [total, payments] = await prisma.$transaction([
    prisma.financialTransaction.count({ where }),
    prisma.financialTransaction.findMany({
      where,
      include: { entries: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  res.status(200).json({
    data: payments,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
};

const recordCredit = async (
  req: Request<BorrowerParams>,
  res: Response,
  kind: CreditKind,
): Promise<void> => {
  const actor = req.user;
  if (!actor) {
    res.status(401).json({ error: "Not authorized" });
    return;
  }
  const hasPermission =
    kind === "WAIVER"
      ? actor.role === "ADMIN"
      : actor.role === "LIBRARIAN";
  if (!hasPermission) {
    res.status(403).json({
      error:
        kind === "WAIVER"
          ? "Only an administrator can approve a waiver"
          : "Only library staff can record a payment",
    });
    return;
  }
  const amount = getPositiveAmount(req.body);
  if (amount === null) {
    res.status(400).json({ error: "amount must be a positive number" });
    return;
  }
  const reason = getOptionalString(req.body, "reason");
  if (kind === "WAIVER" && !reason) {
    res.status(400).json({ error: "reason is required for a waiver" });
    return;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const account = await tx.financialAccount.findUnique({
        where: { borrowerId: req.params.borrowerId },
      });
      if (!account) throw new Error("ACCOUNT_NOT_FOUND");
      const balance = Number(account.outstandingBalance);
      if (amount > balance) throw new Error("NEGATIVE_BALANCE");

      const updated = await tx.financialAccount.update({
        where: { id: account.id },
        data: { outstandingBalance: { decrement: amount } },
      });
      const transaction = await tx.financialTransaction.create({
        data: {
          accountId: account.id,
          createdById: actor.id,
          type: kind,
          sourceKey: `${kind.toLowerCase()}:${req.params.borrowerId}:${randomUUID()}`,
          reason: reason ?? null,
          externalReference: getOptionalString(req.body, "externalReference") ?? null,
          entries: {
            create: {
              component: kind,
              direction: "CREDIT",
              amount,
            },
          },
        },
        include: { entries: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: kind === "WAIVER" ? "FINE_WAIVER_APPROVED" : "FINE_PAYMENT_RECORDED",
          resourceType: "FinancialAccount",
          resourceId: account.id,
          outcome: "SUCCESS",
          beforeData: { outstandingBalance: balance },
          afterData: { outstandingBalance: Number(updated.outstandingBalance) },
          metadata: {
            borrowerId: req.params.borrowerId,
            amount,
            reason: reason ?? null,
            transactionId: transaction.id,
          },
        },
      });
      return { transaction, outstandingBalance: updated.outstandingBalance };
    }, { isolationLevel: "Serializable" });

    res.status(201).json({ message: `${kind} recorded successfully`, data: result });
  } catch (error) {
    if (error instanceof Error && error.message === "ACCOUNT_NOT_FOUND") {
      res.status(404).json({ code: "ACCOUNT_NOT_FOUND", error: "Financial account not found" });
      return;
    }
    if (error instanceof Error && error.message === "NEGATIVE_BALANCE") {
      res.status(409).json({ code: "PAYMENT_EXCEEDS_BALANCE", error: "Credit cannot make outstanding balance negative" });
      return;
    }
    throw error;
  }
};

export const recordPayment = (req: Request<BorrowerParams>, res: Response): Promise<void> =>
  recordCredit(req, res, "PAYMENT");

export const recordWaiver = (req: Request<BorrowerParams>, res: Response): Promise<void> =>
  recordCredit(req, res, "WAIVER");

export const recordAdjustment = async (
  req: Request<BorrowerParams>,
  res: Response,
): Promise<void> => {
  const actor = req.user;
  if (!actor) {
    res.status(401).json({ error: "Not authorized" });
    return;
  }
  if (actor.role !== "ADMIN") {
    res.status(403).json({ error: "Only an administrator can record an adjustment" });
    return;
  }
  const amount = getPositiveAmount(req.body);
  const direction =
    typeof req.body === "object" && req.body !== null
      ? (req.body as Record<string, unknown>).direction
      : undefined;
  const reason = getOptionalString(req.body, "reason");
  if (amount === null || (direction !== "DEBIT" && direction !== "CREDIT") || !reason) {
    res.status(400).json({ error: "positive amount, direction (DEBIT or CREDIT), and reason are required" });
    return;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      let account = await tx.financialAccount.findUnique({
        where: { borrowerId: req.params.borrowerId },
      });
      if (!account) {
        if (direction === "CREDIT") throw new Error("NEGATIVE_BALANCE");
        account = await tx.financialAccount.create({
          data: { borrowerId: req.params.borrowerId, outstandingBalance: 0 },
        });
      }

      const currentBalance = Number(account.outstandingBalance);
      if (direction === "CREDIT" && amount > currentBalance) throw new Error("NEGATIVE_BALANCE");
      const updated = await tx.financialAccount.update({
        where: { id: account.id },
        data: {
          outstandingBalance:
            direction === "DEBIT" ? { increment: amount } : { decrement: amount },
        },
      });
      const transaction = await tx.financialTransaction.create({
        data: {
          accountId: account.id,
          createdById: actor.id,
          type: "ADJUSTMENT",
          sourceKey: `adjustment:${req.params.borrowerId}:${randomUUID()}`,
          reason,
          entries: {
            create: { component: "ADJUSTMENT", direction, amount },
          },
        },
        include: { entries: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "FINANCIAL_ADJUSTMENT_RECORDED",
          resourceType: "FinancialAccount",
          resourceId: account.id,
          outcome: "SUCCESS",
          beforeData: { outstandingBalance: currentBalance },
          afterData: { outstandingBalance: Number(updated.outstandingBalance) },
          metadata: {
            borrowerId: req.params.borrowerId,
            amount,
            direction,
            reason,
            transactionId: transaction.id,
          },
        },
      });
      return { transaction, outstandingBalance: updated.outstandingBalance };
    }, { isolationLevel: "Serializable" });

    res.status(201).json({ message: "Adjustment recorded successfully", data: result });
  } catch (error) {
    if (error instanceof Error && error.message === "NEGATIVE_BALANCE") {
      res.status(409).json({ error: "Credit cannot make outstanding balance negative" });
      return;
    }
    throw error;
  }
};
