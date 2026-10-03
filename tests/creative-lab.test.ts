import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  creativeLabHandoffSchema,
  validateLabHandoff,
} from "../src/creative/lab";

const example = () =>
  JSON.parse(readFileSync("docs/examples/creative-lab-handoff.json", "utf8"));
describe("Creative Lab exchange without visual grammar", () => {
  it("accepts the documented unbound prototype and separates verbatim feedback from observations", () => {
    const p = creativeLabHandoffSchema.parse(example());
    expect(validateLabHandoff(p, { prototype: p.prototype })).toEqual(p);
    expect(p.review.decision_scope).toBe("prototype_visual_only");
    expect(p.publishable).toBe(false);
    expect(p.publication_authorized).toBe(false);
    expect(p.observations[0].source_feedback_ids).toEqual([
      p.daniel_feedback[0].id,
    ]);
    expect(p.rule_candidates[0].status).toBe("unvalidated");
    expect(p).not.toHaveProperty("palette");
    expect(p).not.toHaveProperty("template_id");
  });
  it("cannot convert a reported visual approval into publication or an active learned rule", () => {
    const p = example();
    p.review.state = "approved";
    expect(creativeLabHandoffSchema.safeParse(p).success).toBe(true);
    for (const field of ["publishable", "publication_authorized"]) {
      const bad = structuredClone(p);
      bad[field] = true;
      expect(creativeLabHandoffSchema.safeParse(bad).success).toBe(false);
    }
    p.rule_candidates[0].status = "active";
    expect(creativeLabHandoffSchema.safeParse(p).success).toBe(false);
  });
  it("rejects detached observations, unsupported rule evidence and wrong scene associations", () => {
    for (const corrupt of [
      (p: ReturnType<typeof example>) => {
        p.observations[0].source_feedback_ids = ["missing"];
      },
      (p: ReturnType<typeof example>) => {
        p.rule_candidates[0].observation_ids = ["missing"];
      },
      (p: ReturnType<typeof example>) => {
        p.daniel_feedback[0].scene_id = "missing";
      },
      (p: ReturnType<typeof example>) => {
        p.scenes[0].source_asset_ids = ["missing"];
      },
      (p: ReturnType<typeof example>) => {
        p.review.reported_reviewer = null;
      },
      (p: ReturnType<typeof example>) => {
        p.review.prototype_revision++;
      },
      (p: ReturnType<typeof example>) => {
        p.observations.push(p.observations[0]);
      },
    ]) {
      const p = example();
      corrupt(p);
      expect(creativeLabHandoffSchema.safeParse(p).success).toBe(false);
    }
  });
  it("checks exact trusted prototype, story, brief and scene receipts before future ingestion", () => {
    const p = creativeLabHandoffSchema.parse(example());
    expect(() =>
      validateLabHandoff(p, { prototype: { ...p.prototype, revision: 2 } }),
    ).toThrow("stale");
    expect(() =>
      validateLabHandoff(p, { prototype: p.prototype, scene_ids: [] }),
    ).toThrow("scene");
    const binding = {
      story_id: crypto.randomUUID(),
      content_id: crypto.randomUUID(),
      content_version: 1,
      angle_id: crypto.randomUUID(),
      draft_id: crypto.randomUUID(),
      draft_revision: 1,
    };
    const brief = { id: crypto.randomUUID(), revision: 1 };
    const bound = { ...p, story_id: binding.story_id, binding, brief };
    expect(
      validateLabHandoff(bound, { prototype: p.prototype, binding, brief })
        .binding,
    ).toEqual(binding);
    expect(() => validateLabHandoff(bound, { prototype: p.prototype })).toThrow(
      "trusted editorial",
    );
    expect(() =>
      validateLabHandoff(bound, {
        prototype: p.prototype,
        binding: { ...binding, draft_revision: 2 },
        brief,
      }),
    ).toThrow("stale");
    expect(() =>
      validateLabHandoff(bound, {
        prototype: p.prototype,
        binding,
        brief: { ...brief, revision: 2 },
      }),
    ).toThrow("stale");
    expect(
      creativeLabHandoffSchema.safeParse({
        ...bound,
        story_id: crypto.randomUUID(),
      }).success,
    ).toBe(false);
  });
});
