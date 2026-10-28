import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

let instance: ReturnType<typeof drizzle<typeof schema>> | undefined;

export const db = () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  return (instance ??= drizzle(process.env.DATABASE_URL, { schema }));
};
