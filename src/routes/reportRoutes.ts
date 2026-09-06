import { Router } from "express";

import {
  inventoryReport,
  overdueReport,
  systemSummaryReport,
} from "../controllers/reportController.ts";
import { authMiddleware } from "../middleware/authMiddleware.ts";

const router = Router();
router.use(authMiddleware);
router.get("/overdue", overdueReport);
router.get("/inventory", inventoryReport);
router.get("/system-summary", systemSummaryReport);

export default router;
