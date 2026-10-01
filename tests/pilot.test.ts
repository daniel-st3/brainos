import { afterAll, beforeAll, describe, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { initializeDb } from "../src/server/local-db";
import { localRpc, type Rpc } from "../src/ingestion/store";
import {
  addDays,
  bogotaDate,
  dateOnly,
  daySchema,
  eventsInPilot,
  pilotStoryEvents,
  dailyObservations,
  pilotDates,
  type PilotStudy,
} from "../src/domain/pilot";
import type { PilotEvent } from "../src/ingestion/types";
let db: PGlite;
let rpc: Rpc;
const today = bogotaDate(),
  start = addDays(today, -9);
const day = {
  day: today,
  brief_minutes: 8,
  manual_minutes: 22,
  manual_candidates: 12,
  manual_useful: 3,
  brief_useful: 4,
  verdict: "system_better",
  notes: "Useful context and original sources.",
};
beforeAll(async () => {
  db = await initializeDb();
  rpc = localRpc(db);
});
afterAll(async () => db.close());
describe("ten-day pilot", () => {
  it("uses Bogotá dates and exactly ten days across calendar boundaries", () => {
    expect(bogotaDate(new Date("2026-10-01T03:00:00Z"))).toBe("2026-09-30");
    expect(pilotDates("2026-09-25")).toHaveLength(10);
    expect(pilotDates("2026-09-25").at(-1)).toBe("2026-10-04");
    expect(dateOnly.safeParse("2026-02-30").success).toBe(false);
  });
  it("validates measured values without treating blanks as zero", () => {
    expect(daySchema.safeParse({ ...day, brief_minutes: "" }).success).toBe(
      false,
    );
    expect(daySchema.safeParse({ ...day, manual_useful: 13 }).success).toBe(
      false,
    );
    expect(daySchema.safeParse({ ...day, manual_minutes: -1 }).success).toBe(
      false,
    );
    expect(
      daySchema.parse({ ...day, brief_minutes: "8.5" }).brief_minutes,
    ).toBe(8.5);
  });
  it("requires an explicit start and protects the ten-day window in the database", async () => {
    await expect(
      rpc("save_pilot_day", { p_day: day, p_actor: "Daniel" }),
    ).rejects.toThrow("Start the pilot");
    await rpc("start_pilot", { p_start: start, p_actor: "Daniel" });
    await rpc("start_pilot", { p_start: start, p_actor: "Daniel" });
    await expect(
      rpc("start_pilot", { p_start: today, p_actor: "Daniel" }),
    ).rejects.toThrow("already");
    await expect(
      rpc("save_pilot_day", {
        p_day: { ...day, day: addDays(start, -1) },
        p_actor: "Daniel",
      }),
    ).rejects.toThrow("outside");
    await expect(
      rpc("save_pilot_day", {
        p_day: { ...day, day: addDays(start, 10) },
        p_actor: "Daniel",
      }),
    ).rejects.toThrow("outside");
  });
  it("saves and edits one daily comparison without duplicating it", async () => {
    await rpc("save_pilot_day", { p_day: day, p_actor: "Daniel" });
    await rpc("save_pilot_day", {
      p_day: { ...day, brief_minutes: 9 },
      p_actor: "Daniel",
    });
    const study = (await rpc("read_pilot_study")) as PilotStudy;
    expect(study.config?.starts_on).toBe(start);
    expect(study.days).toHaveLength(1);
    expect(study.days[0].brief_minutes).toBe(9);
    await expect(
      rpc("save_pilot_day", {
        p_day: { ...day, manual_useful: 30 },
        p_actor: "Daniel",
      }),
    ).rejects.toThrow();
  });
  it("excludes pre-pilot observations and deduplicates repeated impressions per day", () => {
    const event = (id: string, time: string): PilotEvent => ({
      id,
      story_id: "one",
      kind: "surfaced",
      brief_id: null,
      rank: 1,
      actor: "Daniel",
      created_at: time,
    });
    const rows = [
      event("a", "2026-09-30T04:59:00Z"),
      event("b", "2026-09-30T05:00:00Z"),
      event("c", "2026-09-30T06:00:00Z"),
    ];
    expect(eventsInPilot(rows, "2026-09-30")).toHaveLength(2);
    expect(dailyObservations(rows, "2026-09-30").surfaced).toBe(1);
  });
  it("keeps pilot tables and RPCs inaccessible to browser roles", async () => {
    const result = await db.query<{ allowed: boolean }>(
      "select has_table_privilege('anon','pilot_days','SELECT') or has_function_privilege('authenticated','save_pilot_day(jsonb,text)','EXECUTE') as allowed",
    );
    expect(result.rows[0].allowed).toBe(false);
  });
  it("retains later content outcomes only for pilot stories without extending daily observations", () => {
    const event = (
      id: string,
      story: string,
      kind: string,
      time: string,
    ): PilotEvent => ({
      id,
      story_id: story,
      kind,
      brief_id: null,
      rank: null,
      actor: "Daniel",
      created_at: time,
    });
    const rows = [
      event("seen", "pilot-story", "surfaced", "2026-09-30T15:00:00Z"),
      event("before", "pilot-story", "content_created", "2026-09-29T15:00:00Z"),
      event("last-day", "pilot-story", "prioritized", "2026-10-10T04:59:59Z"),
      event(
        "later-draft",
        "pilot-story",
        "content_created",
        "2026-10-10T05:00:00Z",
      ),
      event("later-click", "pilot-story", "opened", "2026-10-10T05:00:00Z"),
      event(
        "unrelated",
        "not-in-pilot",
        "content_created",
        "2026-10-10T05:00:00Z",
      ),
    ];
    const selected = pilotStoryEvents(rows, "2026-09-30");
    expect(selected.map((e) => e.id)).toEqual([
      "seen",
      "last-day",
      "later-draft",
    ]);
    expect(eventsInPilot(selected, "2026-09-30").map((e) => e.id)).toEqual([
      "seen",
      "last-day",
    ]);
    expect(dailyObservations(selected, "2026-10-09").drafted).toBe(0);
  });
});
