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

const router = Router();
router.use(authMiddleware);
router.post("/books", createBook);
router.patch("/books/:id", updateBook);
router.post("/authors", createAuthor);
router.get("/authors", listAuthors);
router.patch("/authors/:id", updateAuthor);
router.post("/categories", createCategory);
router.get("/categories", listCategories);
router.patch("/categories/:id", updateCategory);
router.post("/copies", createCopy);
router.patch("/copies/:id", updateCopy);

export default router;
