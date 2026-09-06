import type { Request, Response } from "express";
import bcrypt from "bcryptjs";

import { prisma } from "../config/db.ts";

type UserParams = { userId: string };
type UserRole = "STUDENT" | "LECTURER" | "LIBRARIAN" | "ADMIN";
type AccountStatus = "ACTIVE" | "DISABLED";

const publicUserSelect = {
  id: true,
  universityId: true,
  fullName: true,
  email: true,
  role: true,
  accountStatus: true,
  createAt: true,
  updateAt: true,
} as const;

const isRole = (value: unknown): value is UserRole =>
  value === "STUDENT" || value === "LECTURER" || value === "LIBRARIAN" || value === "ADMIN";

const isAccountStatus = (value: unknown): value is AccountStatus =>
  value === "ACTIVE" || value === "DISABLED";

const stringValue = (body: Record<string, unknown>, key: string): string | undefined => {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

export const getCurrentUser = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ code: "UNAUTHORIZED", error: "Not authorized" });
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: publicUserSelect });
  if (!user) {
    res.status(404).json({ code: "USER_NOT_FOUND", error: "User not found" });
    return;
  }
  res.status(200).json({ data: user });
};

export const listUsers = async (req: Request, res: Response): Promise<void> => {
  const actor = req.user;
  if (!actor) {
    res.status(401).json({ code: "UNAUTHORIZED", error: "Not authorized" });
    return;
  }
  if (actor.role !== "LIBRARIAN" && actor.role !== "ADMIN") {
    res.status(403).json({ code: "FORBIDDEN", error: "Staff access required" });
    return;
  }

  const pageValue = typeof req.query.page === "string" ? Number(req.query.page) : 1;
  const limitValue = typeof req.query.limit === "string" ? Number(req.query.limit) : 20;
  const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const limit = Math.min(Number.isInteger(limitValue) && limitValue > 0 ? limitValue : 20, 100);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const requestedRole = typeof req.query.role === "string" && isRole(req.query.role)
    ? req.query.role
    : undefined;
  const roleFilter = actor.role === "LIBRARIAN"
    ? { in: ["STUDENT", "LECTURER"] as UserRole[] }
    : requestedRole;
  const where = {
    ...(roleFilter ? { role: roleFilter } : {}),
    ...(q
      ? {
          OR: [
            { universityId: { contains: q, mode: "insensitive" as const } },
            { fullName: { contains: q, mode: "insensitive" as const } },
            { email: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [total, users] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: publicUserSelect,
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  res.status(200).json({
    data: users,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
};

export const createManagedUser = async (req: Request, res: Response): Promise<void> => {
  const actor = req.user;
  if (!actor || actor.role !== "ADMIN") {
    res.status(actor ? 403 : 401).json({
      code: actor ? "FORBIDDEN" : "UNAUTHORIZED",
      error: actor ? "Only an administrator can create managed users" : "Not authorized",
    });
    return;
  }
  if (typeof req.body !== "object" || req.body === null) {
    res.status(400).json({ code: "VALIDATION_ERROR", error: "Request body is required" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const universityId = stringValue(body, "universityId");
  const fullName = stringValue(body, "fullName");
  const email = stringValue(body, "email")?.toLowerCase();
  const password = stringValue(body, "password");
  const role = body.role;
  if (!universityId || !fullName || !email || !password || password.length < 8 || !isRole(role)) {
    res.status(400).json({
      code: "VALIDATION_ERROR",
      error: "universityId, fullName, email, password (minimum 8 characters), and role are required",
    });
    return;
  }

  const duplicate = await prisma.user.findFirst({ where: { OR: [{ universityId }, { email }] } });
  if (duplicate) {
    res.status(409).json({ code: "USER_ALREADY_EXISTS", error: "University ID or email already exists" });
    return;
  }
  const password_hash = await bcrypt.hash(password, 12);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { universityId, fullName, email, password_hash, role },
      select: publicUserSelect,
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: "USER_CREATED",
        resourceType: "User",
        resourceId: created.id,
        outcome: "SUCCESS",
        afterData: created,
      },
    });
    return created;
  });
  res.status(201).json({ data: user });
};

export const updateManagedUser = async (
  req: Request<UserParams>,
  res: Response,
): Promise<void> => {
  const actor = req.user;
  if (!actor || actor.role !== "ADMIN") {
    res.status(actor ? 403 : 401).json({
      code: actor ? "FORBIDDEN" : "UNAUTHORIZED",
      error: actor ? "Only an administrator can manage users" : "Not authorized",
    });
    return;
  }
  if (typeof req.body !== "object" || req.body === null) {
    res.status(400).json({ code: "VALIDATION_ERROR", error: "Request body is required" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const role = body.role;
  const accountStatus = body.accountStatus;
  if (role !== undefined && !isRole(role)) {
    res.status(400).json({ code: "VALIDATION_ERROR", error: "Invalid role" });
    return;
  }
  if (accountStatus !== undefined && !isAccountStatus(accountStatus)) {
    res.status(400).json({ code: "VALIDATION_ERROR", error: "Invalid accountStatus" });
    return;
  }

  const current = await prisma.user.findUnique({
    where: { id: req.params.userId },
    select: publicUserSelect,
  });
  if (!current) {
    res.status(404).json({ code: "USER_NOT_FOUND", error: "User not found" });
    return;
  }
  const removesActiveAdmin =
    current.role === "ADMIN" &&
    current.accountStatus === "ACTIVE" &&
    (role !== undefined && role !== "ADMIN" || accountStatus === "DISABLED");
  if (removesActiveAdmin) {
    const activeAdmins = await prisma.user.count({ where: { role: "ADMIN", accountStatus: "ACTIVE" } });
    if (activeAdmins <= 1) {
      res.status(409).json({ code: "LAST_ACTIVE_ADMIN", error: "Cannot remove the last active administrator" });
      return;
    }
  }

  const email = stringValue(body, "email")?.toLowerCase();
  const fullName = stringValue(body, "fullName");
  if (email) {
    const emailOwner = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (emailOwner && emailOwner.id !== current.id) {
      res.status(409).json({ code: "EMAIL_ALREADY_EXISTS", error: "Email already exists" });
      return;
    }
  }
  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: current.id },
      data: {
        ...(email ? { email } : {}),
        ...(fullName ? { fullName } : {}),
        ...(role ? { role } : {}),
        ...(accountStatus ? { accountStatus } : {}),
      },
      select: publicUserSelect,
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: accountStatus && accountStatus !== current.accountStatus
          ? "ACCOUNT_STATUS_CHANGED"
          : role && role !== current.role
            ? "USER_ROLE_CHANGED"
            : "USER_UPDATED",
        resourceType: "User",
        resourceId: current.id,
        outcome: "SUCCESS",
        beforeData: current,
        afterData: user,
      },
    });
    return user;
  });
  res.status(200).json({ data: updated });
};

export const listAuditLogs = async (req: Request, res: Response): Promise<void> => {
  const actor = req.user;
  if (!actor || actor.role !== "ADMIN") {
    res.status(actor ? 403 : 401).json({
      code: actor ? "FORBIDDEN" : "UNAUTHORIZED",
      error: actor ? "Only an administrator can view audit logs" : "Not authorized",
    });
    return;
  }
  const pageValue = typeof req.query.page === "string" ? Number(req.query.page) : 1;
  const limitValue = typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
  const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const limit = Math.min(Number.isInteger(limitValue) && limitValue > 0 ? limitValue : 50, 100);
  const where = {
    ...(typeof req.query.action === "string" ? { action: req.query.action } : {}),
    ...(typeof req.query.actorId === "string" ? { actorId: req.query.actorId } : {}),
  };
  const [total, logs] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  res.status(200).json({
    data: logs,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
};
