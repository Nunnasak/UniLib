import { Router } from "express";

import { borrowBook } from "../controllers/bookController.ts";
import { createReservation } from "../controllers/reservationController.ts";
import { searchBooks } from "../controllers/searchController.ts";
import { authMiddleware } from "../middleware/authMiddleware.ts";
import { requireIdempotencyKey } from "../middleware/idempotencyMiddleware.ts";

const router = Router();

router.use(authMiddleware);
router.get("/search", searchBooks);
router.post("/:bookId/borrow", requireIdempotencyKey("BORROW"), borrowBook);
router.post(
  "/:bookId/reservations",
  requireIdempotencyKey("CREATE_RESERVATION"),
  createReservation,
);

export default router;
