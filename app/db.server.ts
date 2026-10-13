import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./db/schema";

declare global {
  // eslint-disable-next-line no-var
  var __pg: ReturnType<typeof postgres> | undefined;
}

const client = globalThis.__pg ?? postgres(process.env.DATABASE_URL ?? "", { max: 10 });
if (process.env.NODE_ENV !== "production") globalThis.__pg = client;

export const db = drizzle(client, { schema });
export * from "./db/schema";
