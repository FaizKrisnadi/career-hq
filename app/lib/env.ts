import { env as workerEnv } from "cloudflare:workers";

export interface Env {
  DB: D1Database;
  DOCS: R2Bucket;
  ENGINE_API_KEY: string;
  ASSETS: Fetcher;
  IMAGES: unknown;
}

export function getEnv(): Env {
  return workerEnv as Env;
}
