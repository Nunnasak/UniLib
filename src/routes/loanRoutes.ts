import { Router } from "express";

import {
  confirmLoanLost,
  getLoan,
  renewLoan,
  returnLoan,
} from "../controllers/bookController.ts";
import { authMiddleware } from "../middleware/authMiddleware.ts";

const router = Router();

router.use(authMiddleware);
router.get("/:loanId", getLoan);
router.post("/:loanId/renew", renewLoan);
router.post("/:loanId/return", returnLoan);
router.post("/:loanId/confirm-lost", confirmLoanLost);

export default router;
