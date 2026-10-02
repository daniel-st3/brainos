import { timingSafeEqual } from "node:crypto";
export function workerAuthorized(value: string | null) {
  if (!value) return false;
  const previous = process.env.PRODUCTION_WORKER_TOKEN_PREVIOUS,
    until = Date.parse(
      process.env.PRODUCTION_WORKER_TOKEN_PREVIOUS_UNTIL ?? "",
    );
  const candidates = [
    process.env.PRODUCTION_WORKER_TOKEN,
    ...(previous &&
    Number.isFinite(until) &&
    until > Date.now() &&
    until - Date.now() <= 90 * 60000
      ? [previous]
      : []),
  ];
  const b = Buffer.from(value);
  return candidates.some((token) => {
    if (!token || token.length < 32) return false;
    const a = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}
