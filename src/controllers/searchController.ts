import type { Request, Response } from "express";
import type { Prisma } from "../../generated/prisma/client.ts";

import { prisma } from "../config/db.ts";

type SearchQuery = {
  isbn?: string;
  title?: string;
  author?: string;
  category?: string;
  availability?: string;
  page?: string;
  limit?: string;
  sortBy?: string;
  sortOrder?: string;
};

const parsePositiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const searchBooks = async (
  req: Request<Record<string, never>, unknown, unknown, SearchQuery>,
  res: Response,
): Promise<void> => {
  const page = parsePositiveInteger(req.query.page, 1);
  const limit = Math.min(parsePositiveInteger(req.query.limit, 20), 100);
  const sortOrder = req.query.sortOrder === "desc" ? "desc" : "asc";
  const allowedSortFields = ["title", "isbn13", "publicationYear", "createdAt"] as const;
  const sortBy = allowedSortFields.includes(req.query.sortBy as (typeof allowedSortFields)[number])
    ? (req.query.sortBy as (typeof allowedSortFields)[number])
    : "title";

  const availability = req.query.availability?.toUpperCase() ?? "ALL";
  if (availability !== "ALL" && availability !== "AVAILABLE" && availability !== "UNAVAILABLE") {
    res.status(400).json({ code: "INVALID_AVAILABILITY", error: "availability must be AVAILABLE, UNAVAILABLE, or ALL" });
    return;
  }

  const where: Prisma.BookWhereInput = {
    isActive: true,
    ...(req.query.isbn
      ? { isbn13: { contains: req.query.isbn.trim(), mode: "insensitive" } }
      : {}),
    ...(req.query.title
      ? { title: { contains: req.query.title.trim(), mode: "insensitive" } }
      : {}),
    ...(req.query.author
      ? {
          authors: {
            some: { author: { name: { contains: req.query.author.trim(), mode: "insensitive" } } },
          },
        }
      : {}),
    ...(req.query.category
      ? {
          categories: {
            some: { category: { name: { contains: req.query.category.trim(), mode: "insensitive" } } },
          },
        }
      : {}),
    ...(availability === "AVAILABLE"
      ? { copies: { some: { status: "AVAILABLE" } } }
      : availability === "UNAVAILABLE"
        ? { copies: { none: { status: "AVAILABLE" } } }
        : {}),
  };
  const orderBy = { [sortBy]: sortOrder } as Prisma.BookOrderByWithRelationInput;

  const [total, books] = await prisma.$transaction([
    prisma.book.count({ where }),
    prisma.book.findMany({
      where,
      orderBy: [orderBy, { id: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        authors: {
          orderBy: { position: "asc" },
          include: { author: { select: { id: true, name: true } } },
        },
        categories: {
          include: { category: { select: { id: true, name: true } } },
        },
        _count: {
          select: { copies: { where: { status: "AVAILABLE" } } },
        },
      },
    }),
  ]);

  res.status(200).json({
    data: books.map((book) => ({
      ...book,
      availableCopyCount: book._count.copies,
      authors: book.authors.map(({ author }) => author),
      categories: book.categories.map(({ category }) => category),
      _count: undefined,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    sorting: { sortBy, sortOrder },
  });
};
