import { commandSchema, type Command } from "./commands";
import { demoAI } from "@/services/ai";
import type { Draft, Story, StoryStatus } from "./types";
export class WorkflowError extends Error {}
export const transitions: Record<StoryStatus, readonly StoryStatus[]> = {
  detected: ["verified"],
  verified: ["researched"],
  researched: ["angle_ready"],
  angle_ready: ["drafted"],
  drafted: ["assets_cleared", "researched"],
  assets_cleared: ["recording_needed", "render_ready", "researched"],
  recording_needed: ["review", "researched"],
  render_ready: ["review", "researched"],
  review: ["approved", "drafted", "researched"],
  approved: ["scheduled", "drafted", "researched"],
  scheduled: ["published", "drafted", "researched"],
  published: ["measured"],
  measured: [],
};
function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new WorkflowError(message);
}
export function assertTransition(from: StoryStatus, to: StoryStatus) {
  ensure(
    transitions[from].includes(to),
    `Cannot move from ${from} to ${to}. Complete the preceding editorial step.`,
  );
}
export function activeDraft(story: Story) {
  return story.drafts.find((d) => d.id === story.active_draft_id);
}
export function clearanceIssues(story: Story, draft: Draft): string[] {
  return draft.asset_ids.flatMap((id) => {
    const asset = story.assets.find((a) => a.id === id);
    return !asset
      ? [`Selected asset ${id} is missing.`]
      : asset.rights_status !== "cleared" ||
          !asset.publishable ||
          !asset.usage_basis.trim() ||
          !asset.cleared_by
        ? [`${asset.title}: ${asset.rights_status} rights; clearance required.`]
        : [];
  });
}
export function approvalIssues(story: Story, draft?: Draft): string[] {
  if (!draft) return ["Choose a draft revision."];
  const issues = clearanceIssues(story, draft);
  if (story.active_draft_id !== draft.id)
    issues.push("Only the active revision can be reviewed.");
  if (
    story.drafts.some(
      (d) => d.platform === draft.platform && d.revision > draft.revision,
    )
  )
    issues.push("A newer revision exists.");
  if (!story.research_confirmed)
    issues.push("Confirm research after checking the evidence.");
  if (
    !story.angles.some(
      (a) => a.id === draft.angle_id && a.approval_state === "approved",
    )
  )
    issues.push("Daniel must explicitly approve the chosen angle.");
  if (draft.claim_ids.length === 0)
    issues.push("Link at least one supported claim.");
  for (const id of draft.claim_ids) {
    const claim = story.claims.find((c) => c.id === id);
    if (
      !claim ||
      claim.verification_status !== "supported" ||
      !story.evidence.some(
        (e) =>
          e.claim_id === id &&
          e.excerpt.trim() &&
          story.sources.some(
            (s) => s.id === e.source_id && s.excerpt.includes(e.excerpt),
          ),
      )
    )
      issues.push(`Unresolved evidence: ${claim?.text ?? "missing claim"}`);
  }
  if (
    draft.platform === "x" &&
    [draft.hook, draft.body, draft.cta].join("\n").length > 280
  )
    issues.push("X copy exceeds the 280-character limit.");
  return issues;
}
function findDraft(story: Story, id: string) {
  const d = story.drafts.find((d) => d.id === id);
  ensure(d, "Draft revision not found.");
  return d;
}
export async function applyCommand(
  original: Story,
  input: Command,
  actor: string,
  now = new Date().toISOString(),
): Promise<Story> {
  const command = commandSchema.parse(input);
  const story = structuredClone(original);
  const log = (
    type: string,
    detail: string,
    draftId: string | null = null,
    from: StoryStatus | null = null,
    to: StoryStatus | null = null,
  ) =>
    story.events.push({
      id: crypto.randomUUID(),
      story_id: story.id,
      type,
      detail,
      actor,
      draft_id: draftId,
      from_status: from,
      to_status: to,
      created_at: now,
    });
  const move = (target: StoryStatus, detail: string) => {
    assertTransition(story.status, target);
    const from = story.status;
    story.status = target;
    log("transition", detail, story.active_draft_id, from, target);
  };
  const invalidate = (reason: string) => {
    for (const d of story.drafts)
      if (d.status === "approved") d.status = "superseded";
    for (const p of story.publications)
      if (p.status !== "published_manual") p.status = "cancelled";
    story.production_completed = false;
    story.production_checklist = [];
    log("approval_invalidated", reason, story.active_draft_id);
  };
  const editable = () =>
    ensure(
      !["published", "measured"].includes(story.status),
      "Published history is locked. Start a follow-up story for corrections.",
    );
  switch (command.type) {
    case "prioritize":
      story.priority = !story.priority;
      log("priority", story.priority ? "Pinned for today" : "Priority removed");
      break;
    case "archive":
      story.archived = !story.archived;
      log(
        "archive",
        story.archived ? "Archived from active queues" : "Restored to newsroom",
      );
      break;
    case "transition": {
      ensure(
        !["approved", "scheduled", "published", "measured"].includes(
          command.target,
        ),
        "Use the dedicated review or publishing action.",
      );
      const d = activeDraft(story);
      if (command.target === "verified")
        ensure(
          story.sources.some((s) => s.is_primary) &&
            story.claims.length > 0 &&
            story.claims.every(
              (c) =>
                c.verification_status === "supported" &&
                story.evidence.some(
                  (e) =>
                    e.claim_id === c.id &&
                    e.excerpt.trim() &&
                    story.sources.some(
                      (s) =>
                        s.id === e.source_id && s.excerpt.includes(e.excerpt),
                    ),
                ),
            ),
          "Verify every claim against primary evidence first.",
        );
      if (command.target === "researched") {
        ensure(
          story.status === "verified",
          "Use Return to research to reopen an existing package.",
        );
        ensure(
          story.research_confirmed && story.research_notes.trim(),
          "Save and confirm research notes first.",
        );
      }
      if (command.target === "angle_ready")
        ensure(
          story.angles.some((a) => a.approval_state === "approved"),
          "Approve an angle explicitly first.",
        );
      if (command.target === "drafted")
        ensure(
          story.status === "angle_ready" &&
            d?.status === "draft" &&
            !d.approved_at,
          "Create a fresh draft revision first.",
        );
      if (command.target === "assets_cleared") {
        ensure(d, "Choose a draft first.");
        ensure(
          clearanceIssues(story, d).length === 0,
          clearanceIssues(story, d).join(" "),
        );
      }
      if (command.target === "recording_needed")
        ensure(
          d?.platform === "short_video",
          "Only a short-video draft enters recording.",
        );
      if (command.target === "render_ready")
        ensure(
          d && d.platform !== "short_video",
          "Face-led video requires the recording branch.",
        );
      if (command.target === "review") {
        ensure(
          d?.status === "draft" && !d.approved_at,
          "Create an unapproved revision before requesting another review.",
        );
        const issues = approvalIssues(story, d);
        ensure(!issues.length, issues.join(" "));
      }
      move(command.target, `Moved to ${command.target.replaceAll("_", " ")}`);
      break;
    }
    case "research":
      editable();
      story.research_notes = command.notes;
      story.research_confirmed = command.confirmed;
      invalidate("Research changed; prior approvals require a new review.");
      if (
        [
          "assets_cleared",
          "recording_needed",
          "render_ready",
          "review",
          "approved",
          "scheduled",
        ].includes(story.status)
      )
        move("researched", "Research updated");
      log("research", "Research notes saved");
      break;
    case "verify_claim": {
      editable();
      const c = story.claims.find((c) => c.id === command.claimId);
      ensure(c, "Claim not found.");
      if (command.verification === "supported")
        ensure(
          story.evidence.some(
            (e) =>
              e.claim_id === c.id &&
              e.excerpt.trim() &&
              story.sources.some(
                (s) => s.id === e.source_id && s.excerpt.includes(e.excerpt),
              ),
          ),
          "A matching source excerpt is required.",
        );
      c.verification_status = command.verification;
      c.notes = command.notes;
      story.research_confirmed = false;
      invalidate("Claim verification changed.");
      if (
        [
          "drafted",
          "assets_cleared",
          "recording_needed",
          "render_ready",
          "review",
          "approved",
          "scheduled",
        ].includes(story.status)
      )
        move("researched", "Evidence reopened");
      log("claim_checked", `${command.verification}: ${c.text}`);
      break;
    }
    case "suggest_angles":
      editable();
      for (const a of await demoAI.suggestAngles(story))
        story.angles.push({
          ...a,
          id: crypto.randomUUID(),
          story_id: story.id,
          created_by: "ai",
          approval_state: "suggested",
          approved_by: null,
          approved_at: null,
          created_at: now,
          provenance: "deterministic-demo/v1",
        });
      log(
        "angles_suggested",
        "Three mock AI suggestions created; none confirmed as Daniel’s opinion.",
      );
      break;
    case "add_angle":
      editable();
      story.angles.push({
        id: crypto.randomUUID(),
        story_id: story.id,
        text: command.text,
        rationale: command.rationale,
        kind: "opinion",
        created_by: "human",
        approval_state: "suggested",
        approved_by: null,
        approved_at: null,
        created_at: now,
        provenance: "human-authored",
      });
      log("angle_added", "Human angle added for explicit confirmation.");
      break;
    case "approve_angle": {
      editable();
      const a = story.angles.find((a) => a.id === command.angleId);
      ensure(a, "Angle not found.");
      a.approval_state = "approved";
      a.approved_by = actor;
      a.approved_at = now;
      log(
        "angle_approved",
        "Angle approved for this story only; no permanent belief saved.",
      );
      break;
    }
    case "generate_draft": {
      editable();
      ensure(
        ["angle_ready", "drafted", "review", "approved", "scheduled"].includes(
          story.status,
        ),
        "Complete research and angle selection before drafting.",
      );
      const angle = story.angles.find((a) => a.id === command.angleId);
      ensure(
        angle?.approval_state === "approved",
        "Approve the angle before drafting.",
      );
      const output = await demoAI.generateDraft(story, angle, command.platform);
      const d: Draft = {
        ...output,
        id: crypto.randomUUID(),
        story_id: story.id,
        platform: command.platform,
        language: story.primary_language,
        revision:
          Math.max(
            0,
            ...story.drafts
              .filter((d) => d.platform === command.platform)
              .map((d) => d.revision),
          ) + 1,
        status: "draft",
        angle_id: angle.id,
        claim_ids: story.claims.map((c) => c.id),
        asset_ids: [],
        approved_at: null,
        approved_by: null,
        created_at: now,
        provenance: "deterministic-demo/v1",
      };
      invalidate("New draft selected.");
      story.drafts.push(d);
      story.active_draft_id = d.id;
      if (story.status !== "drafted")
        move("drafted", "New draft revision created");
      log("draft_created", `${d.platform} revision ${d.revision}`, d.id);
      break;
    }
    case "edit_draft": {
      editable();
      const previous = findDraft(story, command.draftId);
      ensure(
        previous.id === story.active_draft_id,
        "Only the active revision can be edited.",
      );
      ensure(
        command.assetIds.every((id) => story.assets.some((a) => a.id === id)),
        "Selected asset not found.",
      );
      const d: Draft = {
        ...previous,
        id: crypto.randomUUID(),
        hook: command.hook,
        body: command.body,
        cta: command.cta,
        shot_notes: command.shotNotes,
        asset_ids: command.assetIds,
        revision:
          Math.max(
            ...story.drafts
              .filter((d) => d.platform === previous.platform)
              .map((d) => d.revision),
          ) + 1,
        status: "draft",
        approved_by: null,
        approved_at: null,
        created_at: now,
        provenance: "human-edit",
      };
      invalidate(
        `Revision ${previous.revision} preserved; edits need fresh approval.`,
      );
      story.drafts.push(d);
      story.active_draft_id = d.id;
      if (story.status !== "drafted") {
        if (
          ["assets_cleared", "recording_needed", "render_ready"].includes(
            story.status,
          )
        ) {
          move("researched", "Draft changed; clearance must be repeated");
          move("angle_ready", "Previously approved angle retained");
        }
        move("drafted", "Edited revision enters review preparation");
      }
      log(
        "draft_edited",
        `Created revision ${d.revision} from revision ${previous.revision}`,
        d.id,
      );
      break;
    }
    case "select_draft": {
      editable();
      const d = findDraft(story, command.draftId);
      ensure(
        !story.drafts.some(
          (x) => x.platform === d.platform && x.revision > d.revision,
        ),
        "Historical revisions cannot be reactivated.",
      );
      ensure(
        ["drafted", "review", "approved", "scheduled"].includes(story.status),
        "Select a revision while drafting or reviewing.",
      );
      invalidate("Active draft changed.");
      if (d.approved_at) {
        const fresh: Draft = {
          ...d,
          id: crypto.randomUUID(),
          revision:
            Math.max(
              ...story.drafts
                .filter((x) => x.platform === d.platform)
                .map((x) => x.revision),
            ) + 1,
          status: "draft",
          approved_at: null,
          approved_by: null,
          created_at: now,
          provenance: "human-reselected",
        };
        story.drafts.push(fresh);
        story.active_draft_id = fresh.id;
      } else {
        story.active_draft_id = d.id;
        d.status = "draft";
      }
      if (story.status !== "drafted")
        move("drafted", "Selected draft for a fresh review");
      log(
        "draft_selected",
        "Revision selected for a fresh review",
        story.active_draft_id,
      );
      break;
    }
    case "asset_rights": {
      editable();
      const a = story.assets.find((a) => a.id === command.assetId);
      ensure(a, "Asset not found.");
      a.rights_status = command.rights;
      a.usage_basis = command.basis;
      a.attribution = command.attribution;
      a.publishable = command.rights === "cleared";
      a.cleared_by = a.publishable ? actor : null;
      a.cleared_at = a.publishable ? now : null;
      if (story.drafts.some((d) => d.asset_ids.includes(a.id))) {
        invalidate("Selected asset rights changed.");
        if (
          [
            "assets_cleared",
            "recording_needed",
            "render_ready",
            "review",
            "approved",
            "scheduled",
          ].includes(story.status)
        )
          move("researched", "Rights changed; reopen the editorial package");
      }
      log("asset_rights", `${a.title}: ${a.rights_status}; ${command.basis}`);
      break;
    }
    case "add_asset":
      editable();
      story.assets.push({
        id: crypto.randomUUID(),
        story_id: story.id,
        draft_id: null,
        type: command.assetType,
        title: command.title,
        source_url: command.sourceUrl,
        storage_url: null,
        publisher: command.publisher,
        retrieved_at: now,
        usage_basis: "Not yet documented",
        attribution: "",
        rights_status: "unknown",
        publishable: false,
        notes: "Added manually; clearance required.",
        cleared_by: null,
        cleared_at: null,
      });
      log("asset_added", `${command.title}: unknown rights`);
      break;
    case "approve": {
      ensure(
        story.status === "review",
        "Only a package in Review can be approved.",
      );
      const d = findDraft(story, command.draftId);
      const issues = approvalIssues(story, d);
      ensure(!issues.length, issues.join(" "));
      ensure(
        d.status === "draft" && !d.approved_at,
        "Approval requires a fresh unapproved revision.",
      );
      d.status = "approved";
      d.approved_by = actor;
      d.approved_at = now;
      move("approved", `Approved exact ${d.platform} revision ${d.revision}`);
      log(
        "approval",
        `Human confirmed copy, evidence, personal assertions and rights for revision ${d.revision}`,
        d.id,
      );
      story.publications.push({
        id: crypto.randomUUID(),
        story_id: story.id,
        draft_id: d.id,
        platform: d.platform,
        destination: "Not selected",
        scheduled_at: null,
        status: "ready_to_schedule",
        published_url: null,
        created_at: now,
      });
      break;
    }
    case "request_changes":
    case "reject": {
      ensure(
        story.status === "review",
        "This action is available during review.",
      );
      const d = findDraft(story, command.draftId);
      ensure(d.id === story.active_draft_id, "Review the active revision.");
      d.status = command.type === "reject" ? "rejected" : "changes_requested";
      invalidate(command.reason);
      move("drafted", command.reason);
      log(command.type, command.reason, d.id);
      break;
    }
    case "return_research":
      editable();
      ensure(
        [
          "drafted",
          "assets_cleared",
          "recording_needed",
          "render_ready",
          "review",
          "approved",
          "scheduled",
        ].includes(story.status),
        "This package has not reached drafting yet.",
      );
      invalidate(command.reason);
      story.research_confirmed = false;
      move("researched", command.reason);
      break;
    case "production": {
      ensure(
        ["recording_needed", "render_ready", "review", "approved"].includes(
          story.status,
        ),
        "Enter a production branch before completing the checklist.",
      );
      story.production_checklist = [...new Set(command.checklist)];
      story.production_completed = ["script", "sound", "visuals"].every((c) =>
        story.production_checklist.includes(c),
      );
      log(
        "production",
        story.production_completed
          ? "Recording/render preparation completed"
          : "Production checklist updated",
      );
      break;
    }
    case "schedule": {
      const d = findDraft(story, command.draftId);
      ensure(
        d.status === "approved" &&
          d.approved_at &&
          d.approved_by &&
          story.active_draft_id === d.id,
        "Only the current, explicitly approved revision may be scheduled.",
      );
      ensure(
        story.status === "approved",
        "The story must be approved before scheduling.",
      );
      ensure(
        story.production_completed,
        "Complete the production checklist before scheduling.",
      );
      const issues = approvalIssues(story, d);
      ensure(!issues.length, issues.join(" "));
      ensure(
        Date.parse(command.scheduledAt) > Date.parse(now),
        "Choose a future scheduled time.",
      );
      const p = story.publications.find(
        (p) => p.draft_id === d.id && p.status === "ready_to_schedule",
      );
      ensure(p, "Approved queue entry not found.");
      p.destination = command.destination;
      p.scheduled_at = command.scheduledAt;
      p.status = "scheduled_internal";
      move(
        "scheduled",
        "Scheduled internally; external integration still required",
      );
      log("scheduled", `${command.scheduledAt} · ${command.destination}`, d.id);
      break;
    }
    case "mark_published": {
      ensure(
        story.status === "scheduled",
        "Schedule the approved revision first.",
      );
      const p = story.publications.find(
        (p) =>
          p.id === command.publicationId && p.status === "scheduled_internal",
      );
      ensure(p, "Internal schedule entry not found.");
      const d = findDraft(story, p.draft_id);
      ensure(
        d.status === "approved" &&
          d.id === story.active_draft_id &&
          !approvalIssues(story, d).length,
        "Approval or clearance is no longer current.",
      );
      p.status = "published_manual";
      p.published_url = command.url;
      move(
        "published",
        "Daniel recorded a manual publication; no API was called",
      );
      break;
    }
  }
  story.version = original.version + 1;
  story.updated_at = now;
  return story;
}
