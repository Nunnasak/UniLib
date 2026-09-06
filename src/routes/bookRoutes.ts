import { Router } from "express";

import { borrowBook } from "../controllers/bookController.ts";
import { createReservation } from "../controllers/reservationController.ts";
import { authMiddleware } from "../middleware/authMiddleware.ts";

const router = Router();

router.use(authMiddleware);
router.post("/:bookId/borrow", borrowBook);
router.post("/:bookId/reservations", createReservation);

export default router;
