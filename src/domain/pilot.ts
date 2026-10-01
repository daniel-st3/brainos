import { z } from "zod";
import type { PilotEvent } from "../ingestion/types";
export const verdicts = [
  "system_better",
  "manual_better",
  "about_equal",
  "undecided",
] as const;
export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      Number.isFinite(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    "Use a valid calendar date",
  );
const minutes = z
  .union([z.number(), z.string().trim().min(1)])
  .transform(Number)
  .pipe(z.number().min(0).max(240));
const count = z
  .union([z.number(), z.string().trim().min(1)])
  .transform(Number)
  .pipe(z.number().int().min(0).max(500));
export const daySchema = z
  .object({
    day: dateOnly,
    brief_minutes: minutes,
    manual_minutes: minutes,
    manual_candidates: count,
    manual_useful: count,
    brief_useful: count,
    verdict: z.enum(verdicts),
    notes: z.string().trim().max(5000),
  })
  .refine(
    (d) => d.manual_useful <= d.manual_candidates,
    "Useful manual stories cannot exceed manually checked candidates",
  );
export type PilotDay = z.infer<typeof daySchema> & {
  updated_at: string;
  actor: string;
};
export interface PilotStudy {
  config: { starts_on: string; created_at: string; actor: string } | null;
  days: PilotDay[];
}
export function bogotaDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function addDays(date: string, amount: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}
export function pilotDates(start: string) {
  return Array.from({ length: 10 }, (_, i) => addDays(start, i));
}
export function eventsInPilot(events: PilotEvent[], start: string) {
  const end = addDays(start, 9);
  return events.filter((e) => {
    const day = bogotaDate(new Date(e.created_at));
    return day >= start && day <= end;
  });
}
export function dailyObservations(events: PilotEvent[], day: string) {
  const rows = events.filter((e) => bogotaDate(new Date(e.created_at)) === day);
  const unique = (kind: string) =>
    new Set(rows.filter((e) => e.kind === kind).map((e) => e.story_id)).size;
  return {
    surfaced: unique("surfaced"),
    opened: unique("opened"),
    saved: unique("prioritized"),
    dismissed: unique("dismissed"),
    manual_misses: unique("manual_miss"),
    drafted: unique("content_created"),
  };
}
