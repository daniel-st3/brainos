import { describe, it, expect } from "vitest";
import { createDemoStories } from "../src/domain/seed";
import {
  applyCommand,
  assertTransition,
  clearanceIssues,
  transitions,
  activeDraft,
} from "../src/domain/workflow";
import type { Story, StoryStatus } from "../src/domain/types";
const actor = "Daniel";
const review = () => createDemoStories()[1];
const now = "2026-09-30T12:00:00.000Z";
async function approve(s: Story) {
  return applyCommand(
    s,
    { type: "approve", draftId: s.active_draft_id!, confirmed: true },
    actor,
    now,
  );
}
describe("central workflow transitions", () => {
  it("permits every configured forward transition", () => {
    for (const [from, targets] of Object.entries(transitions))
      for (const to of targets)
        expect(() => assertTransition(from as StoryStatus, to)).not.toThrow();
  });
  it("rejects invalid jumps and terminal mutations", async () => {
    expect(() => assertTransition("detected", "approved")).toThrow();
    await expect(
      applyCommand(
        createDemoStories()[0],
        { type: "transition", target: "approved" },
        actor,
      ),
    ).rejects.toThrow("dedicated");
    expect(() => assertTransition("measured", "detected")).toThrow();
  });
  it("enforces the recording versus rendering branch", async () => {
    const s = createDemoStories()[2];
    s.status = "assets_cleared";
    expect(
      (
        await applyCommand(
          s,
          { type: "transition", target: "recording_needed" },
          actor,
        )
      ).status,
    ).toBe("recording_needed");
    await expect(
      applyCommand(s, { type: "transition", target: "render_ready" }, actor),
    ).rejects.toThrow("recording");
    s.drafts.find((d) => d.id === s.active_draft_id)!.platform = "instagram";
    expect(
      (
        await applyCommand(
          s,
          { type: "transition", target: "render_ready" },
          actor,
        )
      ).status,
    ).toBe("render_ready");
    await expect(
      applyCommand(
        s,
        { type: "transition", target: "recording_needed" },
        actor,
      ),
    ).rejects.toThrow();
  });
  it("returns a package to research and cancels dependent approval/queue state", async () => {
    const s = await approve(review());
    const returned = await applyCommand(
      s,
      { type: "return_research", reason: "Check availability in Colombia" },
      actor,
    );
    expect(returned.status).toBe("researched");
    expect(returned.research_confirmed).toBe(false);
    expect(returned.publications[0].status).toBe("cancelled");
    expect(activeDraft(returned)?.status).toBe("superseded");
  });
  it("cannot bypass invalidation through the generic transition action", async () => {
    const s = await approve(review());
    await expect(
      applyCommand(s, { type: "transition", target: "drafted" }, actor),
    ).rejects.toThrow();
    await expect(
      applyCommand(s, { type: "transition", target: "researched" }, actor),
    ).rejects.toThrow("Return to research");
  });
});
describe("exact revision approval", () => {
  it("approves only the selected exact revision and records the decision", async () => {
    const s = await approve(review());
    expect(s.drafts.find((d) => d.revision === 2)?.status).toBe("approved");
    expect(s.drafts.find((d) => d.revision === 1)?.status).toBe("superseded");
    expect(s.events.at(-1)?.draft_id).toBe(s.active_draft_id);
    expect(s.publications[0].draft_id).toBe(s.active_draft_id);
  });
  it("rejects stale revision approval", async () => {
    const s = review();
    await expect(
      applyCommand(
        s,
        { type: "approve", draftId: s.drafts[0].id, confirmed: true },
        actor,
      ),
    ).rejects.toThrow("active revision");
  });
  it("editing approved content preserves old content and creates a new unapproved revision", async () => {
    const s = await approve(review()),
      d = activeDraft(s)!;
    const edited = await applyCommand(
      s,
      {
        type: "edit_draft",
        draftId: d.id,
        hook: "A new hook",
        body: d.body,
        cta: d.cta,
        shotNotes: d.shot_notes,
        assetIds: d.asset_ids,
      },
      actor,
    );
    expect(edited.drafts).toHaveLength(3);
    expect(activeDraft(edited)?.approved_at).toBeNull();
    expect(activeDraft(edited)?.status).toBe("draft");
    expect(edited.drafts.find((x) => x.id === d.id)?.body).toBe(d.body);
    expect(edited.drafts.find((x) => x.id === d.id)?.approved_at).toBe(now);
    expect(edited.publications[0].status).toBe("cancelled");
    expect(edited.status).toBe("drafted");
  });
  it("allows only approved revisions to schedule and requires production preparation", async () => {
    let s = review();
    const cmd = {
      type: "schedule" as const,
      draftId: s.active_draft_id!,
      scheduledAt: "2027-01-01T15:00:00.000Z",
      destination: "Instagram",
    };
    await expect(applyCommand(s, cmd, actor, now)).rejects.toThrow("approved");
    s = await approve(s);
    await expect(applyCommand(s, cmd, actor, now)).rejects.toThrow(
      "production",
    );
    s = await applyCommand(
      s,
      { type: "production", checklist: ["script", "sound", "visuals"] },
      actor,
    );
    const scheduled = await applyCommand(s, cmd, actor, now);
    expect(scheduled.status).toBe("scheduled");
    expect(scheduled.publications[0].status).toBe("scheduled_internal");
    expect(scheduled.publications[0].published_url).toBeNull();
  });
  it("requires supported claims, confirmed research, and explicit angle approval", async () => {
    for (const change of [
      (s: Story) => {
        s.claims[0].verification_status = "conflicting";
      },
      (s: Story) => {
        s.research_confirmed = false;
      },
      (s: Story) => {
        s.angles[0].approval_state = "suggested";
      },
      (s: Story) => {
        s.evidence = [];
      },
    ]) {
      const s = review();
      change(s);
      await expect(approve(s)).rejects.toThrow();
    }
  });
  it("request changes and rejection preserve the revision and record the reason", async () => {
    for (const type of ["request_changes", "reject"] as const) {
      const s = review();
      const result = await applyCommand(
        s,
        {
          type,
          draftId: s.active_draft_id!,
          reason: "Rework the first-person statement",
        },
        actor,
      );
      expect(result.status).toBe("drafted");
      expect(activeDraft(result)?.body).toBe(activeDraft(s)?.body);
      expect(result.events.at(-1)?.detail).toContain("first-person");
    }
  });
});
describe("asset clearance", () => {
  it.each(["unknown", "blocked"] as const)(
    "%s rights cannot pass clearance or approval",
    async (rights) => {
      const s = review(),
        d = activeDraft(s)!;
      const asset = s.assets.find((a) => a.rights_status === rights)!;
      d.asset_ids = [asset.id];
      expect(clearanceIssues(s, d)).toHaveLength(1);
      await expect(approve(s)).rejects.toThrow("clearance");
      s.status = "drafted";
      await expect(
        applyCommand(
          s,
          { type: "transition", target: "assets_cleared" },
          actor,
        ),
      ).rejects.toThrow("clearance");
    },
  );
  it("allows explicitly publishable assets with a documented basis", async () => {
    const s = review();
    expect(clearanceIssues(s, activeDraft(s)!)).toEqual([]);
    expect((await approve(s)).status).toBe("approved");
  });
  it("ignores unselected research assets and permits text-only packages", async () => {
    const s = review();
    activeDraft(s)!.asset_ids = [];
    expect((await approve(s)).status).toBe("approved");
  });
  it("changing selected rights invalidates approval and schedules", async () => {
    const s = await approve(review());
    const changed = await applyCommand(
      s,
      {
        type: "asset_rights",
        assetId: activeDraft(s)!.asset_ids[0],
        rights: "blocked",
        basis: "Permission revoked",
        attribution: "",
      },
      actor,
    );
    expect(changed.status).toBe("researched");
    expect(changed.publications[0].status).toBe("cancelled");
  });
});
describe("opinion and generation boundaries", () => {
  it("AI suggestions never automatically become confirmed opinions", async () => {
    const s = await applyCommand(review(), { type: "suggest_angles" }, actor);
    const newAngles = s.angles.slice(-3);
    expect(newAngles).toHaveLength(3);
    expect(
      newAngles.every(
        (a) =>
          a.approval_state === "suggested" &&
          a.created_by === "ai" &&
          a.approved_at === null,
      ),
    ).toBe(true);
  });
  it("new draft generation clears approval and records mock provenance", async () => {
    const s = await approve(review());
    const result = await applyCommand(
      s,
      {
        type: "generate_draft",
        angleId: s.angles[0].id,
        platform: "newsletter",
      },
      actor,
    );
    expect(result.status).toBe("drafted");
    expect(activeDraft(result)?.status).toBe("draft");
    expect(activeDraft(result)?.provenance).toBe("deterministic-demo/v1");
    expect(result.publications[0].status).toBe("cancelled");
  });
});

describe("complete lifecycle and revision recovery", () => {
  it("moves a detected story through every editorial gate to an internal schedule", async () => {
    let s = createDemoStories()[0];
    s = await applyCommand(
      s,
      {
        type: "verify_claim",
        claimId: s.claims[0].id,
        verification: "supported",
        notes: "Checked against the fictional source fixture",
      },
      actor,
      now,
    );
    s = await applyCommand(
      s,
      { type: "transition", target: "verified" },
      actor,
      now,
    );
    s = await applyCommand(
      s,
      {
        type: "research",
        notes: "Confirmed scenario notes; no real results asserted.",
        confirmed: true,
      },
      actor,
      now,
    );
    s = await applyCommand(
      s,
      { type: "transition", target: "researched" },
      actor,
      now,
    );
    s = await applyCommand(
      s,
      { type: "approve_angle", angleId: s.angles[0].id },
      actor,
      now,
    );
    s = await applyCommand(
      s,
      { type: "transition", target: "angle_ready" },
      actor,
      now,
    );
    s = await applyCommand(
      s,
      {
        type: "generate_draft",
        angleId: s.angles[0].id,
        platform: "short_video",
      },
      actor,
      now,
    );
    for (const target of [
      "assets_cleared",
      "recording_needed",
      "review",
    ] as const)
      s = await applyCommand(s, { type: "transition", target }, actor, now);
    s = await approve(s);
    s = await applyCommand(
      s,
      { type: "production", checklist: ["script", "sound", "visuals"] },
      actor,
      now,
    );
    s = await applyCommand(
      s,
      {
        type: "schedule",
        draftId: s.active_draft_id!,
        destination: "Demo Instagram",
        scheduledAt: "2027-01-02T10:00:00.000Z",
      },
      actor,
      now,
    );
    expect(s.status).toBe("scheduled");
    expect(s.publications[0].status).toBe("scheduled_internal");
    expect(
      s.events.filter((e) => e.type === "transition").length,
    ).toBeGreaterThanOrEqual(8);
  });
  it("reselecting previously approved copy makes a fresh revision without rewriting approval history", async () => {
    let s = await approve(review());
    const old = activeDraft(s)!;
    s = await applyCommand(
      s,
      {
        type: "generate_draft",
        angleId: s.angles[0].id,
        platform: "newsletter",
      },
      actor,
      now,
    );
    s = await applyCommand(
      s,
      { type: "select_draft", draftId: old.id },
      actor,
      now,
    );
    expect(activeDraft(s)?.id).not.toBe(old.id);
    expect(activeDraft(s)?.approved_at).toBeNull();
    expect(s.drafts.find((d) => d.id === old.id)?.approved_at).toBe(now);
  });
  it("a cleared label without publishable permission is insufficient", async () => {
    const s = review();
    s.assets[0].publishable = false;
    await expect(approve(s)).rejects.toThrow("clearance");
  });
  it("rejected copy must be revised before another review", async () => {
    let s = review();
    s = await applyCommand(
      s,
      { type: "reject", draftId: s.active_draft_id!, reason: "Wrong framing" },
      actor,
    );
    s = await applyCommand(
      s,
      { type: "transition", target: "assets_cleared" },
      actor,
    );
    s = await applyCommand(
      s,
      { type: "transition", target: "render_ready" },
      actor,
    );
    await expect(
      applyCommand(s, { type: "transition", target: "review" }, actor),
    ).rejects.toThrow("unapproved revision");
  });
});
