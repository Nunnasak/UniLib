import { Router } from "express";

import {
  getCurrentUser,
  login,
  logout,
  refresh,
  register,
} from "../controllers/authController.ts";
import { authMiddleware } from "../middleware/authMiddleware.ts";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/logout", logout);
router.post("/refresh", refresh);
router.get("/me", authMiddleware, getCurrentUser);

export default router;
