import type { Request, Response } from "express";

import { prisma } from "../config/db.ts";

type BookParams = {
  bookId: string;
};

type AddBookBody = {
  title: string;
  author: string;
  types: string[];
};

const isAddBookBody = (body: unknown): body is AddBookBody => {
  if (typeof body !== "object" || body === null) return false;

  const candidate = body as Record<string, unknown>;
  return (
    typeof candidate.title === "string" &&
    candidate.title.trim().length > 0 &&
    typeof candidate.author === "string" &&
    candidate.author.trim().length > 0 &&
    Array.isArray(candidate.types) &&
    candidate.types.length > 0 &&
    candidate.types.every((type) => typeof type === "string")
  );
};

export const borrowBook = async (
  req: Request<BookParams>,
  res: Response,
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: "Not authorized" });
    return;
  }

  const { bookId } = req.params;
  const book = await prisma.book.findUnique({
    where: { id: bookId },
  });

  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }

  if (book.status !== "AVAILABLE") {
    res.status(409).json({ error: "Book is not available" });
    return;
  }

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 7);

  const borrowRecord = await prisma.borrowRecord.create({
    data: {
      userId: req.user.id,
      bookId,
      dueDate,
    },
  });

  await prisma.book.update({
    where: { id: bookId },
    data: { status: "BORROWED" },
  });

  res.status(201).json({
    message: "book borrowed successfully",
    borrowRecord,
  });
};

export const returnBook = async (
  req: Request<BookParams>,
  res: Response,
): Promise<void> => {
  const { bookId } = req.params;
  const borrowRecord = await prisma.borrowRecord.findFirst({
    where: {
      bookId,
      returnDate: null,
    },
    orderBy: {
      borrowDate: "desc",
    },
  });

  if (!borrowRecord) {
    res.status(409).json({ error: "This book is not currently borrowed" });
    return;
  }

  const returnedRecord = await prisma.borrowRecord.update({
    where: { id: borrowRecord.id },
    data: { returnDate: new Date() },
  });

  await prisma.book.update({
    where: { id: bookId },
    data: { status: "AVAILABLE" },
  });

  res.status(200).json({
    message: "Book returned successfully",
    borrowRecord: returnedRecord,
  });
};

export const addBook = async (req: Request, res: Response): Promise<void> => {
  if (!isAddBookBody(req.body)) {
    res.status(409).json({ error: "title, author and types are required" });
    return;
  }

  const { title, author, types } = req.body;
  const book = await prisma.book.create({
    data: {
      title,
      author,
      types,
    },
  });

  res.status(201).json({
    message: "Book added successfully",
    book,
  });
};
