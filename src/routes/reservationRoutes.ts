import { Router } from "express";

import {
  cancelReservation,
  listMyReservations,
} from "../controllers/reservationController.ts";
import { authMiddleware } from "../middleware/authMiddleware.ts";

const router = Router();

router.use(authMiddleware);
router.get("/", listMyReservations);
router.post("/:reservationId/cancel", cancelReservation);

export default router;
