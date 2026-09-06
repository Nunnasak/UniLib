import "dotenv/config";
import { defineConfig } from "prisma/config";

import { getDatabaseUrl } from "./src/config/env.ts";

export default defineConfig({
  schema: "prisma/schema.prisma",

  migrations: {
    path: "prisma/migrations",
    seed: "node --env-file=.env prisma/seed.ts",
  },

  datasource: {
    url: getDatabaseUrl(),
  },
});
