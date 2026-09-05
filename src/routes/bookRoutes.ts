import { Router } from "express";

import {
  addBook,
  borrowBook,
  returnBook,
} from "../controllers/bookController.ts";
import { authMiddleware } from "../middleware/authMiddleware.ts";

const router = Router();

router.use(authMiddleware);
router.post("/", addBook);
router.post("/:bookId/borrow", borrowBook);
router.post("/:bookId/return", returnBook);

export default router;
