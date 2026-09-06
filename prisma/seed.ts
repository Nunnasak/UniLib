import { disconnectDB, prisma } from "../src/config/db.ts";

const authors = [
  { id: "00000000-0000-4000-8000-000000000201", name: "Robert C. Martin" },
  { id: "00000000-0000-4000-8000-000000000202", name: "Martin Kleppmann" },
  { id: "00000000-0000-4000-8000-000000000203", name: "Eric Evans" },
  { id: "00000000-0000-4000-8000-000000000204", name: "Andrew Hunt" },
  { id: "00000000-0000-4000-8000-000000000205", name: "David Thomas" },
  { id: "00000000-0000-4000-8000-000000000206", name: "Thomas H. Cormen" },
  { id: "00000000-0000-4000-8000-000000000207", name: "Charles E. Leiserson" },
  { id: "00000000-0000-4000-8000-000000000208", name: "Ronald L. Rivest" },
  { id: "00000000-0000-4000-8000-000000000209", name: "Clifford Stein" },
] as const;

const categories = [
  { id: "00000000-0000-4000-8000-000000000301", name: "Software Engineering" },
  { id: "00000000-0000-4000-8000-000000000302", name: "Databases" },
  { id: "00000000-0000-4000-8000-000000000303", name: "Distributed Systems" },
  { id: "00000000-0000-4000-8000-000000000304", name: "Algorithms" },
] as const;

const books = [
  {
    id: "00000000-0000-4000-8000-000000000101",
    isbn13: "9780134494166",
    title: "Clean Architecture",
    description: "Principles and practices for designing maintainable software systems.",
    publisher: "Pearson",
    publicationYear: 2017,
    languageCode: "en",
    authors: ["Robert C. Martin"],
    categories: ["Software Engineering"],
    copies: [
      {
        id: "00000000-0000-4000-8000-000000001001",
        barcode: "CA-000001",
        acquisitionPrice: 1_250,
        acquisitionDate: "2026-01-15",
      },
      {
        id: "00000000-0000-4000-8000-000000001002",
        barcode: "CA-000002",
        acquisitionPrice: 1_250,
        acquisitionDate: "2026-01-15",
      },
    ],
  },
  {
    id: "00000000-0000-4000-8000-000000000102",
    isbn13: "9781449373320",
    title: "Designing Data-Intensive Applications",
    description: "Reliable, scalable, and maintainable data system design.",
    publisher: "O'Reilly Media",
    publicationYear: 2017,
    languageCode: "en",
    authors: ["Martin Kleppmann"],
    categories: ["Databases", "Distributed Systems"],
    copies: [
      {
        id: "00000000-0000-4000-8000-000000001003",
        barcode: "DDIA-000001",
        acquisitionPrice: 1_490,
        acquisitionDate: "2026-02-01",
      },
      {
        id: "00000000-0000-4000-8000-000000001004",
        barcode: "DDIA-000002",
        acquisitionPrice: 1_490,
        acquisitionDate: "2026-02-01",
      },
    ],
  },
  {
    id: "00000000-0000-4000-8000-000000000103",
    isbn13: "9780321125217",
    title: "Domain-Driven Design",
    description: "A systematic approach to complex domain and software modeling.",
    publisher: "Addison-Wesley",
    publicationYear: 2003,
    languageCode: "en",
    authors: ["Eric Evans"],
    categories: ["Software Engineering"],
    copies: [
      {
        id: "00000000-0000-4000-8000-000000001005",
        barcode: "DDD-000001",
        acquisitionPrice: 1_350,
        acquisitionDate: "2026-02-10",
      },
      {
        id: "00000000-0000-4000-8000-000000001006",
        barcode: "DDD-000002",
        acquisitionPrice: 1_350,
        acquisitionDate: "2026-02-10",
      },
    ],
  },
  {
    id: "00000000-0000-4000-8000-000000000104",
    isbn13: "9780135957059",
    title: "The Pragmatic Programmer",
    description: "Practical techniques for becoming a more effective programmer.",
    publisher: "Addison-Wesley",
    publicationYear: 2019,
    languageCode: "en",
    authors: ["Andrew Hunt", "David Thomas"],
    categories: ["Software Engineering"],
    copies: [
      {
        id: "00000000-0000-4000-8000-000000001007",
        barcode: "PP-000001",
        acquisitionPrice: 1_190,
        acquisitionDate: "2026-03-01",
      },
      {
        id: "00000000-0000-4000-8000-000000001008",
        barcode: "PP-000002",
        acquisitionPrice: 1_190,
        acquisitionDate: "2026-03-01",
      },
    ],
  },
  {
    id: "00000000-0000-4000-8000-000000000105",
    isbn13: "9780262046305",
    title: "Introduction to Algorithms",
    description: "A comprehensive introduction to modern algorithms.",
    publisher: "MIT Press",
    publicationYear: 2022,
    languageCode: "en",
    authors: [
      "Thomas H. Cormen",
      "Charles E. Leiserson",
      "Ronald L. Rivest",
      "Clifford Stein",
    ],
    categories: ["Algorithms"],
    copies: [
      {
        id: "00000000-0000-4000-8000-000000001009",
        barcode: "CLRS-000001",
        acquisitionPrice: 1_790,
        acquisitionDate: "2026-03-15",
      },
      {
        id: "00000000-0000-4000-8000-000000001010",
        barcode: "CLRS-000002",
        acquisitionPrice: 1_790,
        acquisitionDate: "2026-03-15",
      },
    ],
  },
] as const;

const authorIdByName = new Map(authors.map((author) => [author.name, author.id]));
const categoryIdByName = new Map(
  categories.map((category) => [category.name, category.id]),
);

const requireMappedId = (
  values: ReadonlyMap<string, string>,
  name: string,
  type: string,
): string => {
  const id = values.get(name);
  if (!id) throw new Error(`Missing seeded ${type}: ${name}`);
  return id;
};

const main = async (): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    for (const author of authors) {
      await tx.author.upsert({
        where: { id: author.id },
        update: { name: author.name },
        create: author,
      });
    }

    for (const category of categories) {
      await tx.category.upsert({
        where: { name: category.name },
        update: { name: category.name },
        create: category,
      });
    }

    for (const bookSeed of books) {
      const book = await tx.book.upsert({
        where: { isbn13: bookSeed.isbn13 },
        update: {
          title: bookSeed.title,
          description: bookSeed.description,
          publisher: bookSeed.publisher,
          publicationYear: bookSeed.publicationYear,
          languageCode: bookSeed.languageCode,
          isActive: true,
        },
        create: {
          id: bookSeed.id,
          isbn13: bookSeed.isbn13,
          title: bookSeed.title,
          description: bookSeed.description,
          publisher: bookSeed.publisher,
          publicationYear: bookSeed.publicationYear,
          languageCode: bookSeed.languageCode,
        },
      });

      await tx.bookAuthor.deleteMany({ where: { bookId: book.id } });
      await tx.bookAuthor.createMany({
        data: bookSeed.authors.map((name, position) => ({
          bookId: book.id,
          authorId: requireMappedId(authorIdByName, name, "author"),
          position,
        })),
      });

      await tx.bookCategory.deleteMany({ where: { bookId: book.id } });
      await tx.bookCategory.createMany({
        data: bookSeed.categories.map((name) => ({
          bookId: book.id,
          categoryId: requireMappedId(categoryIdByName, name, "category"),
        })),
      });

      for (const copy of bookSeed.copies) {
        await tx.bookCopy.upsert({
          where: { barcode: copy.barcode },
          update: {
            bookId: book.id,
            acquisitionPrice: copy.acquisitionPrice,
            acquisitionDate: new Date(`${copy.acquisitionDate}T00:00:00.000Z`),
          },
          create: {
            id: copy.id,
            bookId: book.id,
            barcode: copy.barcode,
            acquisitionPrice: copy.acquisitionPrice,
            acquisitionDate: new Date(`${copy.acquisitionDate}T00:00:00.000Z`),
            status: "AVAILABLE",
          },
        });
      }
    }
  });

  console.log(`Seeded ${books.length} books and 10 physical copies.`);
  console.log(
    "Borrow test IDs: book=00000000-0000-4000-8000-000000000101 copy=00000000-0000-4000-8000-000000001001",
  );
};

main()
  .catch((error: unknown) => {
    console.error("Database seed failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDB();
  });
