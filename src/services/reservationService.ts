import type { Prisma } from "../../generated/prisma/client.ts";

import { prisma } from "../config/db.ts";

export const RESERVATION_HOLD_HOURS = 48;
const HOLD_DURATION_MS = RESERVATION_HOLD_HOURS * 60 * 60 * 1_000;

export const allocateCopyToNextReservation = async (
  tx: Prisma.TransactionClient,
  bookId: string,
  copyId: string,
  now: Date,
) => {
  const next = await tx.reservation.findFirst({
    where: { bookId, status: "QUEUED" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  if (!next) {
    await tx.bookCopy.update({ where: { id: copyId }, data: { status: "AVAILABLE" } });
    return null;
  }

  const holdExpiresAt = new Date(now.getTime() + HOLD_DURATION_MS);
  const allocated = await tx.reservation.updateMany({
    where: { id: next.id, status: "QUEUED" },
    data: {
      status: "HELD",
      allocatedCopyId: copyId,
      allocatedAt: now,
      holdExpiresAt,
    },
  });
  if (allocated.count !== 1) throw new Error("RESERVATION_CHANGED");

  await tx.bookCopy.update({ where: { id: copyId }, data: { status: "ON_HOLD" } });
  return { ...next, status: "HELD" as const, allocatedCopyId: copyId, allocatedAt: now, holdExpiresAt };
};

/**
 * Expires elapsed holds and immediately passes their copies to the next FIFO entry.
 * This is safe to call from both the background worker and request paths.
 */
export const processExpiredReservationHolds = async (now: Date = new Date()): Promise<number> =>
  prisma.$transaction(async (tx) => {
    const expiredHolds = await tx.reservation.findMany({
      where: { status: "HELD", holdExpiresAt: { lte: now } },
      orderBy: [{ holdExpiresAt: "asc" }, { id: "asc" }],
      take: 100,
    });
    let processed = 0;

    for (const hold of expiredHolds) {
      const expired = await tx.reservation.updateMany({
        where: { id: hold.id, status: "HELD", holdExpiresAt: { lte: now } },
        data: {
          status: "EXPIRED",
          expiredAt: now,
          allocatedCopyId: null,
        },
      });
      if (expired.count !== 1) continue;
      processed += 1;

      if (hold.allocatedCopyId) {
        await allocateCopyToNextReservation(tx, hold.bookId, hold.allocatedCopyId, now);
      }
    }

    return processed;
  }, { isolationLevel: "Serializable" });

export const startReservationExpirationWorker = (): NodeJS.Timeout => {
  const run = (): void => {
    void processExpiredReservationHolds().catch((error: unknown) => {
      console.error("Failed to process expired reservation holds", error);
    });
  };

  run();
  const timer = setInterval(run, 60_000);
  timer.unref();
  return timer;
};
