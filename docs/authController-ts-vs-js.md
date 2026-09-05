# `authController.ts` vs `authController.js`

This guide compares the TypeScript controller used by UniLib with the equivalent
JavaScript syntax. It is documentation only; the application should continue to
use `src/controllers/authController.ts`.

## TypeScript version (`.ts`)

```ts
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

export const register = async (
  req: Request,
  res: Response,
): Promise<void> => {
  if (!isAuthRequestBody(req.body)) {
    res.status(400).json({ message: "Name and password are required" });
    return;
  }

  // Registration logic goes here.
};
```

## Equivalent JavaScript version (`.js`)

```js
import bcrypt from "bcryptjs";

import { prisma } from "../config/db.js";
import { generateToken } from "../utils/generateToken.js";

const isAuthRequestBody = (body) => {
  if (typeof body !== "object" || body === null) return false;

  return (
    typeof body.name === "string" &&
    body.name.trim().length > 0 &&
    typeof body.password === "string" &&
    body.password.length > 0
  );
};

export const register = async (req, res) => {
  if (!isAuthRequestBody(req.body)) {
    res.status(400).json({ message: "Name and password are required" });
    return;
  }

  // Registration logic goes here.
};
```

## What is different?

| Feature | TypeScript (`.ts`) | JavaScript (`.js`) |
| --- | --- | --- |
| Type checking | Checks types before the application runs | Most type mistakes appear only while running |
| Express parameters | `req: Request`, `res: Response` | `req`, `res` have no declared types |
| Request-body shape | Declared with `AuthRequestBody` | The expected shape is not declared |
| Unknown input | `unknown` forces validation before use | Any property can be accessed immediately |
| Type guard | `body is AuthRequestBody` informs TypeScript after validation | The function returns only a runtime boolean |
| Type assertion | `as Record<string, unknown>` is available | There is no `as` type syntax |
| Return type | `Promise<void>` documents and checks the async result | The async return type is inferred only at runtime |
| Runtime | Type annotations are removed or ignored | Runs directly as JavaScript |

Both versions still need runtime validation. TypeScript cannot guarantee that an
HTTP client sent a valid body, because request data arrives at runtime. That is
why `isAuthRequestBody()` is useful in both versions.

## What are they for?

JavaScript is the language executed by Node.js and web browsers. Use it when you
want a simple setup, quick scripts, or do not need compile-time type checking.

TypeScript is JavaScript with a static type system. Use it to catch mistakes in
the editor, document the shapes of data, make refactoring safer, and improve
autocomplete. TypeScript types do not exist at runtime.

UniLib is already configured as a TypeScript project, so `.ts` is the better
choice here. It has `typescript`, Express type packages, `tsconfig.json`, and a
development command that runs `src/server.ts` directly with Node.js.

## Important correction in the current controller

The current controller imports this:

```ts
import type { promises } from "node:dns";
```

and declares:

```ts
): promises<void> => {
```

That is not the type for an async function. Remove the `node:dns` import and use
the built-in generic `Promise` type:

```ts
): Promise<void> => {
```

Also, the current `register` function stops immediately after request-body
validation. Database lookup, password hashing, user creation, token generation,
and the success response still need to be implemented.
