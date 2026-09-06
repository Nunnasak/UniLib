import { Router } from "express";

import {
  cancelReservation,
  getReservationQueue,
  listMyReservations,
} from "../controllers/reservationController.ts";
import { authMiddleware } from "../middleware/authMiddleware.ts";
import { requireIdempotencyKey } from "../middleware/idempotencyMiddleware.ts";

const router = Router();

router.use(authMiddleware);
router.get("/", listMyReservations);
router.get("/books/:bookId/queue", getReservationQueue);
router.post(
  "/:reservationId/cancel",
  requireIdempotencyKey("CANCEL_RESERVATION"),
  cancelReservation,
);

export default router;
