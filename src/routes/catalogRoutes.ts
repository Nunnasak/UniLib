import { Router } from "express";

import {
  createAuthor,
  createBook,
  createCategory,
  createCopy,
  listAuthors,
  listCategories,
  updateAuthor,
  updateBook,
  updateCategory,
  updateCopy,
} from "../controllers/catalogController.ts";
import { authMiddleware } from "../middleware/authMiddleware.ts";
import { requireIdempotencyKey } from "../middleware/idempotencyMiddleware.ts";

const router = Router();
router.use(authMiddleware);
router.post("/books", requireIdempotencyKey("CREATE_BOOK"), createBook);
router.patch("/books/:id", requireIdempotencyKey("UPDATE_BOOK"), updateBook);
router.post("/authors", requireIdempotencyKey("CREATE_AUTHOR"), createAuthor);
router.get("/authors", listAuthors);
router.patch("/authors/:id", requireIdempotencyKey("UPDATE_AUTHOR"), updateAuthor);
router.post("/categories", requireIdempotencyKey("CREATE_CATEGORY"), createCategory);
router.get("/categories", listCategories);
router.patch("/categories/:id", requireIdempotencyKey("UPDATE_CATEGORY"), updateCategory);
router.post("/copies", requireIdempotencyKey("CREATE_COPY"), createCopy);
router.patch("/copies/:id", requireIdempotencyKey("UPDATE_COPY"), updateCopy);

export default router;
