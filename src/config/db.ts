import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.ts";
import { getRequiredEnv } from "./env.ts";

const adapter = new PrismaPg({
  connectionString: getRequiredEnv("DATABASE_URL"),
});

export const prisma = new PrismaClient({ adapter });

export const connectDB = async (): Promise<void> => {
  await prisma.$connect();
  console.log("Database connected through Prisma");
};

export const disconnectDB = async (): Promise<void> => {
  await prisma.$disconnect();
};
