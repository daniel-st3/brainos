import { timingSafeEqual } from "node:crypto";
export function workerAuthorized(value: string | null) {
  const expected = process.env.PRODUCTION_WORKER_TOKEN;
  if (!expected || expected.length < 32 || !value) return false;
  const a = Buffer.from(expected),
    b = Buffer.from(value);
  return a.length === b.length && timingSafeEqual(a, b);
}
