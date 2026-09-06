import { Router } from "express";

import {
  getFinancialAccount,
  listPayments,
  recordAdjustment,
  recordPayment,
  recordWaiver,
} from "../controllers/financialController.ts";
import { authMiddleware } from "../middleware/authMiddleware.ts";

const router = Router();

router.use(authMiddleware);
router.get("/:borrowerId", getFinancialAccount);
router.get("/:borrowerId/payments", listPayments);
router.post("/:borrowerId/payments", recordPayment);
router.post("/:borrowerId/waivers", recordWaiver);
router.post("/:borrowerId/adjustments", recordAdjustment);

export default router;
