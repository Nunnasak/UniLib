import { Router } from "express";

import {
  createManagedUser,
  listAuditLogs,
  listUsers,
  updateManagedUser,
} from "../controllers/userController.ts";
import { authMiddleware } from "../middleware/authMiddleware.ts";
import { requireIdempotencyKey } from "../middleware/idempotencyMiddleware.ts";

const router = Router();
router.use(authMiddleware);
router.get("/", listUsers);
router.post("/", requireIdempotencyKey("CREATE_USER"), createManagedUser);
router.patch("/:userId", requireIdempotencyKey("UPDATE_USER"), updateManagedUser);

export const auditRouter = Router();
auditRouter.use(authMiddleware);
auditRouter.get("/", listAuditLogs);

export default router;
