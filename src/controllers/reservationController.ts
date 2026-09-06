import type { Request, Response } from "express";

import { prisma } from "../config/db.ts";
import {
  allocateCopyToNextReservation,
  processExpiredReservationHolds,
} from "../services/reservationService.ts";

type BookParams = { bookId: string };
type ReservationParams = { reservationId: string };

const ACTIVE_RESERVATION_LIMIT = 3;
const FINANCIAL_BLOCK_THRESHOLD = 500;

export const createReservation = async (
  req: Request<BookParams>,
  res: Response,
): Promise<void> => {
  const borrower = req.user;
  if (!borrower) {
    res.status(401).json({ error: "Not authorized" });
    return;
  }
  if (borrower.role !== "STUDENT" && borrower.role !== "LECTURER") {
    res.status(403).json({ error: "Only students and lecturers can reserve books" });
    return;
  }
  if (borrower.accountStatus === "DISABLED") {
    res.status(403).json({ error: "Account is disabled" });
    return;
  }

  await processExpiredReservationHolds();

  try {
    const reservation = await prisma.$transaction(async (tx) => {
      const [book, activeCount, duplicate, activeLoan, availableCopy, account] = await Promise.all([
        tx.book.findUnique({ where: { id: req.params.bookId }, select: { id: true, isActive: true } }),
        tx.reservation.count({
          where: { borrowerId: borrower.id, status: { in: ["QUEUED", "HELD"] } },
        }),
        tx.reservation.findFirst({
          where: {
            borrowerId: borrower.id,
            bookId: req.params.bookId,
            status: { in: ["QUEUED", "HELD"] },
          },
          select: { id: true },
        }),
        tx.loan.findFirst({
          where: { borrowerId: borrower.id, bookId: req.params.bookId, status: "ACTIVE" },
          select: { id: true },
        }),
        tx.bookCopy.findFirst({
          where: { bookId: req.params.bookId, status: "AVAILABLE" },
          select: { id: true },
        }),
        tx.financialAccount.findUnique({
          where: { borrowerId: borrower.id },
          select: { outstandingBalance: true },
        }),
      ]);

      if (!book || !book.isActive) throw new Error("BOOK_NOT_FOUND");
      if (Number(account?.outstandingBalance ?? 0) >= FINANCIAL_BLOCK_THRESHOLD) {
        throw new Error("OUTSTANDING_FINE");
      }
      if (activeCount >= ACTIVE_RESERVATION_LIMIT) throw new Error("RESERVATION_LIMIT");
      if (activeLoan) throw new Error("ACTIVE_LOAN_EXISTS");
      if (duplicate) throw new Error("DUPLICATE_RESERVATION");
      if (availableCopy) throw new Error("COPY_AVAILABLE");

      return tx.reservation.create({
        data: { borrowerId: borrower.id, bookId: req.params.bookId },
      });
    }, { isolationLevel: "Serializable" });

    res.status(201).json({ message: "Reservation created successfully", data: reservation });
  } catch (error) {
    const messages: Record<string, [number, string]> = {
      BOOK_NOT_FOUND: [404, "Book not found"],
      OUTSTANDING_FINE: [409, "Outstanding balance of 500 baht or more prevents reservation"],
      RESERVATION_LIMIT: [409, "A borrower may have at most 3 active reservations"],
      ACTIVE_LOAN_EXISTS: [409, "Cannot reserve a book that you are currently borrowing"],
      DUPLICATE_RESERVATION: [409, "An active reservation for this book already exists"],
      COPY_AVAILABLE: [409, "This book has a copy available for immediate borrowing"],
    };
    const mapped = error instanceof Error ? messages[error.message] : undefined;
    if (mapped) {
      res.status(mapped[0]).json({ code: (error as Error).message, error: mapped[1] });
      return;
    }
    throw error;
  }
};

export const cancelReservation = async (
  req: Request<ReservationParams>,
  res: Response,
): Promise<void> => {
  const borrower = req.user;
  if (!borrower) {
    res.status(401).json({ error: "Not authorized" });
    return;
  }

  await processExpiredReservationHolds();
  const now = new Date();

  try {
    const cancelled = await prisma.$transaction(async (tx) => {
      const current = await tx.reservation.findUnique({
        where: { id: req.params.reservationId },
      });
      if (!current || current.borrowerId !== borrower.id) throw new Error("RESERVATION_NOT_FOUND");
      if (current.status === "COMPLETED") throw new Error("RESERVATION_COMPLETED");
      if (current.status === "CANCELLED" || current.status === "EXPIRED") {
        throw new Error("RESERVATION_NOT_ACTIVE");
      }

      const updated = await tx.reservation.updateMany({
        where: { id: current.id, status: current.status },
        data: {
          status: "CANCELLED",
          cancelledAt: now,
          allocatedCopyId: null,
        },
      });
      if (updated.count !== 1) throw new Error("RESERVATION_CHANGED");

      if (current.status === "HELD" && current.allocatedCopyId) {
        await allocateCopyToNextReservation(tx, current.bookId, current.allocatedCopyId, now);
      }
      return { ...current, status: "CANCELLED" as const, cancelledAt: now, allocatedCopyId: null };
    }, { isolationLevel: "Serializable" });

    res.status(200).json({ message: "Reservation cancelled successfully", data: cancelled });
  } catch (error) {
    const messages: Record<string, [number, string]> = {
      RESERVATION_NOT_FOUND: [404, "Reservation not found"],
      RESERVATION_COMPLETED: [409, "A completed reservation cannot be cancelled"],
      RESERVATION_NOT_ACTIVE: [409, "Reservation is no longer active"],
      RESERVATION_CHANGED: [409, "Reservation state changed; please retry"],
    };
    const mapped = error instanceof Error ? messages[error.message] : undefined;
    if (mapped) {
      res.status(mapped[0]).json({ code: (error as Error).message, error: mapped[1] });
      return;
    }
    throw error;
  }
};

export const listMyReservations = async (_req: Request, res: Response): Promise<void> => {
  const borrower = _req.user;
  if (!borrower) {
    res.status(401).json({ error: "Not authorized" });
    return;
  }
  await processExpiredReservationHolds();
  const pageValue = typeof _req.query.page === "string" ? Number(_req.query.page) : 1;
  const limitValue = typeof _req.query.limit === "string" ? Number(_req.query.limit) : 20;
  const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const limit = Math.min(Number.isInteger(limitValue) && limitValue > 0 ? limitValue : 20, 100);
  const where = { borrowerId: borrower.id };
  const [total, reservations] = await prisma.$transaction([
    prisma.reservation.count({ where }),
    prisma.reservation.findMany({
    where: { borrowerId: borrower.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  const withPositions = await Promise.all(reservations.map(async (reservation) => {
    if (reservation.status !== "QUEUED") return { ...reservation, queuePosition: null };
    const ahead = await prisma.reservation.count({
      where: {
        bookId: reservation.bookId,
        status: "QUEUED",
        OR: [
          { createdAt: { lt: reservation.createdAt } },
          { createdAt: reservation.createdAt, id: { lt: reservation.id } },
        ],
      },
    });
    return { ...reservation, queuePosition: ahead + 1 };
  }));
  res.status(200).json({
    data: withPositions,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
};

export const getReservationQueue = async (
  req: Request<BookParams>,
  res: Response,
): Promise<void> => {
  const actor = req.user;
  if (!actor || actor.role !== "LIBRARIAN") {
    res.status(actor ? 403 : 401).json({
      error: actor ? "Only a librarian can view reservation queues" : "Not authorized",
    });
    return;
  }
  await processExpiredReservationHolds();
  const queue = await prisma.reservation.findMany({
    where: { bookId: req.params.bookId, status: { in: ["HELD", "QUEUED"] } },
    include: {
      borrower: { select: { id: true, universityId: true, fullName: true } },
      allocatedCopy: { select: { id: true, barcode: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 100,
  });
  let queuedPosition = 0;
  res.status(200).json({
    data: queue.map((item) => ({
      ...item,
      queuePosition: item.status === "QUEUED" ? ++queuedPosition : null,
    })),
  });
};
