import { Router } from "express";

import { borrowBook } from "../controllers/bookController.ts";
import { authMiddleware } from "../middleware/authMiddleware.ts";

const router = Router();

router.use(authMiddleware);
router.post("/:bookId/borrow", borrowBook);

export default router;
