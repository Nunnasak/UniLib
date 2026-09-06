import { Router } from "express";

import {
  getFinancialAccount,
  listPayments,
  recordAdjustment,
  recordPayment,
  recordWaiver,
} from "../controllers/financialController.ts";
import { authMiddleware } from "../middleware/authMiddleware.ts";
import { requireIdempotencyKey } from "../middleware/idempotencyMiddleware.ts";

const router = Router();

router.use(authMiddleware);
router.get("/:borrowerId", getFinancialAccount);
router.get("/:borrowerId/payments", listPayments);
router.post(
  "/:borrowerId/payments",
  requireIdempotencyKey("RECORD_PAYMENT"),
  recordPayment,
);
router.post(
  "/:borrowerId/waivers",
  requireIdempotencyKey("WAIVE_FINE"),
  recordWaiver,
);
router.post(
  "/:borrowerId/adjustments",
  requireIdempotencyKey("ADJUST_BALANCE"),
  recordAdjustment,
);

export default router;
