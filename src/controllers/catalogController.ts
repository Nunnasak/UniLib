import type { Request, Response } from "express";

import { prisma } from "../config/db.ts";

type IdParams = { id: string };

const requireLibrarian = (req: Request, res: Response): req is Request & { user: NonNullable<Request["user"]> } => {
  if (!req.user) {
    res.status(401).json({ code: "UNAUTHORIZED", error: "Not authorized" });
    return false;
  }
  if (req.user.role !== "LIBRARIAN") {
    res.status(403).json({ code: "FORBIDDEN", error: "Librarian permission required" });
    return false;
  }
  return true;
};

const objectBody = (body: unknown): Record<string, unknown> | null =>
  typeof body === "object" && body !== null ? body as Record<string, unknown> : null;

const nonEmptyString = (body: Record<string, unknown>, key: string): string | undefined => {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

export const createBook = async (req: Request, res: Response): Promise<void> => {
  if (!requireLibrarian(req, res)) return;
  const body = objectBody(req.body);
  const isbn13 = body && nonEmptyString(body, "isbn13");
  const title = body && nonEmptyString(body, "title");
  const publisher = body && nonEmptyString(body, "publisher");
  const languageCode = body && nonEmptyString(body, "languageCode");
  const publicationYear = body?.publicationYear;
  const authorIds = Array.isArray(body?.authorIds)
    ? body.authorIds.filter((id): id is string => typeof id === "string")
    : [];
  const categoryIds = Array.isArray(body?.categoryIds)
    ? body.categoryIds.filter((id): id is string => typeof id === "string")
    : [];
  if (!isbn13 || isbn13.length !== 13 || !title || !publisher || !languageCode ||
      !Number.isInteger(publicationYear) || authorIds.length === 0 || categoryIds.length === 0) {
    res.status(400).json({
      code: "VALIDATION_ERROR",
      error: "isbn13, title, publisher, publicationYear, languageCode, authorIds, and categoryIds are required",
    });
    return;
  }

  const book = await prisma.$transaction(async (tx) => {
    const created = await tx.book.create({
      data: {
        isbn13,
        title,
        publisher,
        publicationYear: publicationYear as number,
        languageCode,
        description: body && typeof body.description === "string" ? body.description : null,
        authors: {
          create: authorIds.map((authorId, position) => ({ authorId, position })),
        },
        categories: { create: categoryIds.map((categoryId) => ({ categoryId })) },
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: req.user.id,
        action: "BOOK_CREATED",
        resourceType: "Book",
        resourceId: created.id,
        outcome: "SUCCESS",
        afterData: { isbn13, title, publisher, publicationYear: publicationYear as number, languageCode, authorIds, categoryIds },
      },
    });
    return created;
  });
  res.status(201).json({ data: book });
};

export const updateBook = async (req: Request<IdParams>, res: Response): Promise<void> => {
  if (!requireLibrarian(req, res)) return;
  const body = objectBody(req.body);
  if (!body) {
    res.status(400).json({ code: "VALIDATION_ERROR", error: "Request body is required" });
    return;
  }
  const current = await prisma.book.findUnique({ where: { id: req.params.id } });
  if (!current) {
    res.status(404).json({ code: "BOOK_NOT_FOUND", error: "Book not found" });
    return;
  }
  const title = nonEmptyString(body, "title");
  const publisher = nonEmptyString(body, "publisher");
  const languageCode = nonEmptyString(body, "languageCode");
  const updated = await prisma.$transaction(async (tx) => {
    const book = await tx.book.update({
      where: { id: current.id },
      data: {
        ...(title ? { title } : {}),
        ...(publisher ? { publisher } : {}),
        ...(languageCode ? { languageCode } : {}),
        ...(Number.isInteger(body.publicationYear) ? { publicationYear: body.publicationYear as number } : {}),
        ...(typeof body.description === "string" || body.description === null
          ? { description: body.description as string | null }
          : {}),
        ...(typeof body.isActive === "boolean" ? { isActive: body.isActive } : {}),
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: req.user.id,
        action: "BOOK_UPDATED",
        resourceType: "Book",
        resourceId: current.id,
        outcome: "SUCCESS",
        beforeData: current,
        afterData: book,
      },
    });
    return book;
  });
  res.status(200).json({ data: updated });
};

export const createAuthor = async (req: Request, res: Response): Promise<void> => {
  if (!requireLibrarian(req, res)) return;
  const body = objectBody(req.body);
  const name = body && nonEmptyString(body, "name");
  if (!name) {
    res.status(400).json({ code: "VALIDATION_ERROR", error: "name is required" });
    return;
  }
  const author = await prisma.$transaction(async (tx) => {
    const created = await tx.author.create({ data: { name } });
    await tx.auditLog.create({
      data: { actorId: req.user.id, action: "AUTHOR_CREATED", resourceType: "Author", resourceId: created.id, outcome: "SUCCESS", afterData: created },
    });
    return created;
  });
  res.status(201).json({ data: author });
};

export const updateAuthor = async (req: Request<IdParams>, res: Response): Promise<void> => {
  if (!requireLibrarian(req, res)) return;
  const body = objectBody(req.body);
  const name = body && nonEmptyString(body, "name");
  if (!name) {
    res.status(400).json({ code: "VALIDATION_ERROR", error: "name is required" });
    return;
  }
  const current = await prisma.author.findUnique({ where: { id: req.params.id } });
  if (!current) {
    res.status(404).json({ code: "AUTHOR_NOT_FOUND", error: "Author not found" });
    return;
  }
  const author = await prisma.$transaction(async (tx) => {
    const updated = await tx.author.update({ where: { id: current.id }, data: { name } });
    await tx.auditLog.create({
      data: { actorId: req.user.id, action: "AUTHOR_UPDATED", resourceType: "Author", resourceId: current.id, outcome: "SUCCESS", beforeData: current, afterData: updated },
    });
    return updated;
  });
  res.status(200).json({ data: author });
};

export const createCategory = async (req: Request, res: Response): Promise<void> => {
  if (!requireLibrarian(req, res)) return;
  const body = objectBody(req.body);
  const name = body && nonEmptyString(body, "name");
  if (!name) {
    res.status(400).json({ code: "VALIDATION_ERROR", error: "name is required" });
    return;
  }
  const category = await prisma.$transaction(async (tx) => {
    const created = await tx.category.create({ data: { name } });
    await tx.auditLog.create({
      data: { actorId: req.user.id, action: "CATEGORY_CREATED", resourceType: "Category", resourceId: created.id, outcome: "SUCCESS", afterData: created },
    });
    return created;
  });
  res.status(201).json({ data: category });
};

export const updateCategory = async (req: Request<IdParams>, res: Response): Promise<void> => {
  if (!requireLibrarian(req, res)) return;
  const body = objectBody(req.body);
  const name = body && nonEmptyString(body, "name");
  if (!name) {
    res.status(400).json({ code: "VALIDATION_ERROR", error: "name is required" });
    return;
  }
  const current = await prisma.category.findUnique({ where: { id: req.params.id } });
  if (!current) {
    res.status(404).json({ code: "CATEGORY_NOT_FOUND", error: "Category not found" });
    return;
  }
  const category = await prisma.$transaction(async (tx) => {
    const updated = await tx.category.update({ where: { id: current.id }, data: { name } });
    await tx.auditLog.create({
      data: { actorId: req.user.id, action: "CATEGORY_UPDATED", resourceType: "Category", resourceId: current.id, outcome: "SUCCESS", beforeData: current, afterData: updated },
    });
    return updated;
  });
  res.status(200).json({ data: category });
};

export const createCopy = async (req: Request, res: Response): Promise<void> => {
  if (!requireLibrarian(req, res)) return;
  const body = objectBody(req.body);
  const bookId = body && nonEmptyString(body, "bookId");
  const barcode = body && nonEmptyString(body, "barcode");
  const acquisitionPrice = body?.acquisitionPrice;
  const acquisitionDate = body && nonEmptyString(body, "acquisitionDate");
  if (!bookId || !barcode || typeof acquisitionPrice !== "number" || acquisitionPrice < 0 || !acquisitionDate) {
    res.status(400).json({ code: "VALIDATION_ERROR", error: "bookId, barcode, non-negative acquisitionPrice, and acquisitionDate are required" });
    return;
  }
  const date = new Date(`${acquisitionDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    res.status(400).json({ code: "VALIDATION_ERROR", error: "acquisitionDate must be YYYY-MM-DD" });
    return;
  }
  const copy = await prisma.$transaction(async (tx) => {
    const created = await tx.bookCopy.create({ data: { bookId, barcode, acquisitionPrice, acquisitionDate: date } });
    await tx.auditLog.create({
      data: { actorId: req.user.id, action: "COPY_CREATED", resourceType: "BookCopy", resourceId: created.id, outcome: "SUCCESS", afterData: { bookId, barcode, acquisitionPrice, acquisitionDate } },
    });
    return created;
  });
  res.status(201).json({ data: copy });
};

export const updateCopy = async (req: Request<IdParams>, res: Response): Promise<void> => {
  if (!requireLibrarian(req, res)) return;
  const body = objectBody(req.body);
  const statuses = ["AVAILABLE", "MAINTENANCE", "LOST", "RETIRED"] as const;
  const status = body?.status;
  if (!status || !statuses.includes(status as (typeof statuses)[number])) {
    res.status(400).json({ code: "VALIDATION_ERROR", error: "status must be AVAILABLE, MAINTENANCE, LOST, or RETIRED" });
    return;
  }
  const current = await prisma.bookCopy.findUnique({ where: { id: req.params.id } });
  if (!current) {
    res.status(404).json({ code: "COPY_NOT_FOUND", error: "Copy not found" });
    return;
  }
  if (current.status === "ON_LOAN") {
    res.status(409).json({ code: "INVALID_STATE_TRANSITION", error: "An active loan must be closed through circulation" });
    return;
  }
  const copy = await prisma.$transaction(async (tx) => {
    const updated = await tx.bookCopy.update({ where: { id: current.id }, data: { status: status as (typeof statuses)[number] } });
    await tx.auditLog.create({
      data: { actorId: req.user.id, action: "COPY_STATUS_CHANGED", resourceType: "BookCopy", resourceId: current.id, outcome: "SUCCESS", beforeData: { status: current.status }, afterData: { status } },
    });
    return updated;
  });
  res.status(200).json({ data: copy });
};

export const listAuthors = async (req: Request, res: Response): Promise<void> => {
  if (!requireLibrarian(req, res)) return;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const page = typeof req.query.page === "string" && Number(req.query.page) > 0 ? Number(req.query.page) : 1;
  const limit = Math.min(
    typeof req.query.limit === "string" && Number(req.query.limit) > 0 ? Number(req.query.limit) : 20,
    100,
  );
  const where = q ? { name: { contains: q, mode: "insensitive" as const } } : {};
  const [total, authors] = await prisma.$transaction([
    prisma.author.count({ where }),
    prisma.author.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * limit, take: limit }),
  ]);
  res.status(200).json({ data: authors, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
};

export const listCategories = async (req: Request, res: Response): Promise<void> => {
  if (!requireLibrarian(req, res)) return;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const page = typeof req.query.page === "string" && Number(req.query.page) > 0 ? Number(req.query.page) : 1;
  const limit = Math.min(
    typeof req.query.limit === "string" && Number(req.query.limit) > 0 ? Number(req.query.limit) : 20,
    100,
  );
  const where = q ? { name: { contains: q, mode: "insensitive" as const } } : {};
  const [total, categories] = await prisma.$transaction([
    prisma.category.count({ where }),
    prisma.category.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * limit, take: limit }),
  ]);
  res.status(200).json({ data: categories, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
};
