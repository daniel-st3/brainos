import { expect, it } from "vitest";
import { schedulerHealth } from "../src/operations/automation";
it("cloud scheduler timestamps with +00:00 cover the equivalent Z window", () => {
  const health = schedulerHealth(
    [
      {
        lane: "discovery",
        event: "schedule",
        window_at: "2026-10-03T11:30:00+00:00",
        started_at: "2026-10-03T11:30:02+00:00",
        finished_at: "2026-10-03T11:30:19+00:00",
        status: "success",
      },
    ],
    Date.parse("2026-10-03T18:00:00Z"),
  );
  expect(health.discovery.state).toBe("healthy");
});
