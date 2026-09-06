import type { Server } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";

import { connectDB, disconnectDB } from "./config/db.ts";
import { getPort } from "./config/env.ts";
import authRoutes from "./routes/authRoute.ts";
import bookRoutes from "./routes/bookRoutes.ts";
import loanRoutes from "./routes/loanRoutes.ts";
import reservationRoutes from "./routes/reservationRoutes.ts";
import financialRoutes from "./routes/financialRoutes.ts";
import userRoutes, { auditRouter } from "./routes/userRoutes.ts";
import catalogRoutes from "./routes/catalogRoutes.ts";
import reportRoutes from "./routes/reportRoutes.ts";
import { startReservationExpirationWorker } from "./services/reservationService.ts";
import {
  errorHandler,
  normalizeErrorResponses,
  notFoundHandler,
} from "./middleware/errorResponseMiddleware.ts";

const app = express();
const port = getPort();
let server: Server | undefined;
let isShuttingDown = false;

app.use(express.json());
app.use(cookieParser());
app.use(normalizeErrorResponses);
app.use("/auth", authRoutes);
app.use("/books", bookRoutes);
app.use("/loans", loanRoutes);
app.use("/reservations", reservationRoutes);
app.use("/financial-accounts", financialRoutes);
app.use("/users", userRoutes);
app.use("/audit-logs", auditRouter);
app.use("/catalog", catalogRoutes);
app.use("/reports", reportRoutes);
app.use(notFoundHandler);
app.use(errorHandler);


const startServer = async (): Promise<void> => {
  await connectDB();
  startReservationExpirationWorker();

  await new Promise<void>((resolve, reject) => {
    server = app.listen(port, (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      console.log(`Server is running on port ${port}`);
      resolve();
    });
  });
};

const shutdown = async (exitCode: number): Promise<void> => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  if (server?.listening) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });
  }

  await disconnectDB();
  process.exit(exitCode);
};

process.on("unhandledRejection", (error: unknown) => {
  console.error("Unhandled rejection", error);
  void shutdown(1);
});

process.on("uncaughtException", (error: Error) => {
  console.error("Uncaught exception", error);
  void shutdown(1);
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received; shutting down gracefully");
  void shutdown(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT received; shutting down gracefully");
  void shutdown(0);
});

void startServer().catch((error: unknown) => {
  console.error("Failed to start server", error);
  void shutdown(1);
});
