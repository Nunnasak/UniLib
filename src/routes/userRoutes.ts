import { Router } from "express";

import {
  createManagedUser,
  listAuditLogs,
  listUsers,
  updateManagedUser,
} from "../controllers/userController.ts";
import { authMiddleware } from "../middleware/authMiddleware.ts";

const router = Router();
router.use(authMiddleware);
router.get("/", listUsers);
router.post("/", createManagedUser);
router.patch("/:userId", updateManagedUser);

export const auditRouter = Router();
auditRouter.use(authMiddleware);
auditRouter.get("/", listAuditLogs);

export default router;
