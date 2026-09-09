import type { Config } from "drizzle-kit";

export default {
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env["DATABASE_URL"] ?? "" },
  // Las políticas de RLS no se generan desde el esquema: viven en
  // migrations/9999_rls.sql, que se aplica siempre al final.
  verbose: true,
  strict: true,
} satisfies Config;
