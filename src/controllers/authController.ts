import type { Request, Response } from "express";
import bcrypt from "bcryptjs";

import { prisma } from "../config/db.ts";
import { generateToken } from "../utils/generateToken.ts";

type BorrowerRole = "STUDENT" | "LECTURER";

type RegisterRequestBody = {
  universityId: string;
  fullName: string;
  email: string;
  password: string;
  role: BorrowerRole;
};

type LoginRequestBody = {
  universityId: string;
  password: string;
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isBorrowerRole = (value: unknown): value is BorrowerRole =>
  value === "STUDENT" || value === "LECTURER";

const isRegisterRequestBody = (body: unknown): body is RegisterRequestBody => {
  if (typeof body !== "object" || body === null) return false;

  const candidate = body as Record<string, unknown>;
  return (
    isNonEmptyString(candidate.universityId) &&
    isNonEmptyString(candidate.fullName) &&
    isNonEmptyString(candidate.email) &&
    typeof candidate.password === "string" &&
    candidate.password.length >= 8 &&
    isBorrowerRole(candidate.role)
  );
};

const isLoginRequestBody = (body: unknown): body is LoginRequestBody => {
  if (typeof body !== "object" || body === null) return false;

  const candidate = body as Record<string, unknown>;
  return (
    isNonEmptyString(candidate.universityId) &&
    typeof candidate.password === "string" &&
    candidate.password.length > 0
  );
};

export const register = async (req: Request, res: Response): Promise<void> => {
  if (!isRegisterRequestBody(req.body)) {
    res.status(400).json({
      message:
        "universityId, fullName, email, password (minimum 8 characters), and borrower role are required",
    });
    return;
  }

  const universityId = req.body.universityId.trim();
  const fullName = req.body.fullName.trim();
  const email = req.body.email.trim().toLowerCase();
  const { password, role } = req.body;

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ universityId }, { email }],
    },
  });

  if (existingUser) {
    res.status(409).json({
      message: "A user with this universityId or email already exists",
    });
    return;
  }

  const salt = await bcrypt.genSalt(12);
  const hashedPassword = await bcrypt.hash(password, salt);
  const user = await prisma.user.create({
    data: {
      universityId,
      fullName,
      email,
      password_hash: hashedPassword,
      role,
    },
  });

  const token = generateToken(user.id, res);

  res.status(201).json({
    data: {
      user: {
        id: user.id,
        universityId: user.universityId,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
      },
      token,
    },
  });
};

export const login = async (req: Request, res: Response): Promise<void> => {
  if (!isLoginRequestBody(req.body)) {
    res.status(400).json({ message: "universityId and password are required" });
    return;
  }

  const universityId = req.body.universityId.trim();
  const { password } = req.body;
  const user = await prisma.user.findUnique({
    where: { universityId },
  });

  if (!user) {
    res.status(401).json({ message: "Invalid universityId or password" });
    return;
  }

  const isPasswordValid = await bcrypt.compare(password, user.password_hash);

  if (!isPasswordValid) {
    res.status(401).json({ message: "Invalid universityId or password" });
    return;
  }

  if (user.accountStatus === "DISABLED") {
    res.status(403).json({ message: "Account is disabled" });
    return;
  }

  const token = generateToken(user.id, res);

  res.status(200).json({
    data: {
      user: {
        id: user.id,
        universityId: user.universityId,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
      },
      token,
    },
  });
};

export const logout = async (_req: Request, res: Response): Promise<void> => {
  res.cookie("jwt", "", {
    httpOnly: true,
    expires: new Date(0),
  });

  res.status(200).json({
    status: "Success",
    message: "Logged out successfully",
  });
};
