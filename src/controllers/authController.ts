import type { Request, Response } from "express";
import bcrypt from "bcryptjs";

import { prisma } from "../config/db.ts";
import { generateToken } from "../utils/generateToken.ts";

type AuthRequestBody = {
  name: string;
  password: string;
};

const isAuthRequestBody = (body: unknown): body is AuthRequestBody => {
  if (typeof body !== "object" || body === null) return false;

  const candidate = body as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    candidate.name.trim().length > 0 &&
    typeof candidate.password === "string" &&
    candidate.password.length > 0
  );
};

export const register = async (req: Request, res: Response): Promise<void> => {
  if (!isAuthRequestBody(req.body)) {
    res.status(400).json({ message: "Name and password are required" });
    return;
  }

  const { name, password } = req.body;
  const existingUser = await prisma.user.findUnique({
    where: { username: name },
  });

  if (existingUser) {
    res.status(409).json({ message: "The user with this name already exists" });
    return;
  }

  const salt = await bcrypt.genSalt(12);
  const hashedPassword = await bcrypt.hash(password, salt);
  const user = await prisma.user.create({
    data: {
      username: name,
      password_hash: hashedPassword,
    },
  });

  const token = generateToken(user.id, res);

  res.status(201).json({
    data: {
      User: {
        id: user.id,
        username: user.username,
      },
      token,
    },
  });
};

export const login = async (req: Request, res: Response): Promise<void> => {
  if (!isAuthRequestBody(req.body)) {
    res.status(400).json({ message: "Name and password are required" });
    return;
  }

  const { name, password } = req.body;
  const user = await prisma.user.findUnique({
    where: { username: name },
  });

  if (!user) {
    res.status(409).json({ message: "Invalid username or password" });
    return;
  }

  const isPasswordValid = await bcrypt.compare(password, user.password_hash);

  if (!isPasswordValid) {
    res.status(409).json({ message: "Invalid username or password" });
    return;
  }

  const token = generateToken(user.id, res);

  res.status(201).json({
    data: {
      user: {
        id: user.id,
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
