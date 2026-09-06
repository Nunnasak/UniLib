import { Router } from "express";

import {
  confirmLoanLost,
  getLoan,
  listLoans,
  renewLoan,
  returnLoan,
} from "../controllers/bookController.ts";
import { authMiddleware } from "../middleware/authMiddleware.ts";
import { requireIdempotencyKey } from "../middleware/idempotencyMiddleware.ts";

const router = Router();

router.use(authMiddleware);
router.get("/", listLoans);
router.get("/:loanId", getLoan);
router.post("/:loanId/renew", requireIdempotencyKey("RENEW_LOAN"), renewLoan);
router.post("/:loanId/return", requireIdempotencyKey("RETURN_LOAN"), returnLoan);
router.post(
  "/:loanId/confirm-lost",
  requireIdempotencyKey("CONFIRM_LOST"),
  confirmLoanLost,
);

export default router;
