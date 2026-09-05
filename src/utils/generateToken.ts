import type { Response } from "express";
import jwt, { type SignOptions } from "jsonwebtoken";

import { getRequiredEnv } from "../config/env.ts";

export const generateToken = (userId: string, res: Response): string => {
    const expiresIn = (process.env.JWT_EXPIRES_IN ?? "7d") as NonNullable<SignOptions["expiresIn"]>;
    const token = jwt.sign(
        { id: userId },
        getRequiredEnv("JWT_SECRET"),
        { expiresIn },
    );

    res.cookie("jwt", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 1000 * 60 * 60 * 24 * 7,
    });

    return token;
};