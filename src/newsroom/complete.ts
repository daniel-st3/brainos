import { createHash } from "node:crypto";
import type { Rpc } from "../ingestion/store";
import type { Job, Entity } from "../control/model";
import { readControl } from "../control/service";
import { storageClient } from "../integrations/media";
import { validateNewsroomResult } from "./result";
import { createCandidate } from "../approval/service";
import { deliverReviewNotifications } from "../approval/notifications";
const hash = (v: Buffer | string) =>
  createHash("sha256").update(v).digest("hex");
/** Private staging artifact only. The worker cannot set publication binding or clear rights. */
export async function completeNewsroom(rpc: Rpc, job: Job, raw: unknown) {
  const pid = String(job.input.package_id),
    sid = String(job.input.story_id),
    cid = String(job.input.content_id),
    r = validateNewsroomResult(raw, pid);
  const bucket = storageClient().storage.from("brainos-production");
  const files = [];
  for (const m of r.media) {
    const { data, error } = await bucket.download(m.file_id);
    if (error || !data) throw Error("MISSING_FINAL_MEDIA");
    const b = Buffer.from(await data.arrayBuffer());
    if (b.length !== m.bytes || hash(b) !== m.sha256)
      throw Error("FINAL_MEDIA_CHECKSUM");
    files.push({ ...m, mime: "image/png" });
  }
  const archiveBytes = Buffer.from(JSON.stringify(r)),
    archive = {
      name: "production-evidence.json",
      file_id: `${pid}/external/${hash(archiveBytes)}/production-evidence.json`,
      sha256: hash(archiveBytes),
      bytes: archiveBytes.length,
      mime: "application/json",
    };
  const stored = await bucket.upload(archive.file_id, archiveBytes, {
    contentType: archive.mime,
    upsert: false,
  });
  if (stored.error && !/already exists|Duplicate/i.test(stored.error.message))
    throw Error("EVIDENCE_STORAGE_FAILED");
  const now = new Date().toISOString();
  const all = (await rpc("read_newsroom")) as { id: string }[];
  if (!all.some((s) => s.id === sid))
    await rpc("save_story", {
      p_expected_version: -1,
      p_story: {
        id: sid,
        title: r.title,
        summary: r.angle,
        status: "detected",
        pillar: "AI RIGHT NOW",
        story_type: "AI news",
        primary_language: "es",
        discovered_at: now,
        published_at: null,
        urgency: "unknown",
        confidence: "medium",
        audience_relevance: "unknown",
        latam_relevance: "unknown",
        commercial_relevance: "unknown",
        why_matters: r.angle,
        latam_reason: "",
        research_notes:
          "Actual creator-lane story in isolated staging. Automated evidence review; not human approval.",
        research_confirmed: false,
        priority: false,
        archived: false,
        is_demo: true,
        active_draft_id: null,
        production_completed: false,
        production_checklist: [],
        created_at: now,
        updated_at: now,
        version: 0,
        sources: [],
        claims: [],
        evidence: [],
        angles: [],
        drafts: [],
        assets: [],
        events: [],
        publications: [],
      },
    });
  const state = await readControl(rpc, true);
  if (!state.entities.some((e) => e.id === pid)) {
    const common = { version: 1, story_id: sid, draft_id: null, is_demo: true };
    const imported = {
      schema: "external-publication-package/v1",
      revision: `autonomous-staging/${job.id}`,
      archive,
      caption_sha256: hash(r.caption),
      media: files,
      files: [...files, archive],
      manifests: {
        rights: {
          overall_risk: "UNCLEAR — editorial reuse requires assessment",
          rights_clearance: "UNCLEAR",
          assets: r.assets.map((a, i) => ({
            id: `source-${i}`,
            status: "UNCLEAR",
            basis:
              "Publicly accessible authentic media. Access is not permission.",
            ...a,
          })),
          conditions: [
            "Private staging review only. No publication eligibility granted.",
          ],
        },
        sources: {
          url: r.source_url,
          retrieved_at: r.source_retrieved_at,
          sha256: r.source_sha256,
        },
        claims: r.claims,
        asset_manifest: r.media,
        checksums: Object.fromEntries(files.map((f) => [f.name, f.sha256])),
        production_notes: {
          job_id: job.id,
          angle: r.angle,
          visual_thesis: r.visual_thesis,
          qa: r.qa,
          metrics: r.metrics,
        },
      },
      factual_check: {
        checked_at: r.source_retrieved_at,
        source_url: r.source_url,
        checks: {
          method:
            "Primary source text with verbatim evidence quotes and independent model QA; not independent product testing",
        },
      },
    };
    const content: Entity = {
      ...common,
      id: cid,
      kind: "content",
      parent_id: null,
      data: {
        title: r.title,
        pillar: "AI RIGHT NOW",
        purpose: "Unattended real-story staging review",
        platform: "instagram",
        format: "carousel",
        language: "es",
        angle_id: null,
        take_id: null,
        owner: "Daniel Rodriguez",
        content_state: "review",
        production_state: "review",
        distribution_state: "blocked",
        analytics_state: "not_started",
        draft_revision: null,
        production_id: null,
        fresh_until: null,
        evergreen: false,
        claims_reviewed_at: r.source_retrieved_at,
        revalidation_required: false,
        final_approval: null,
        quality_issues: [],
      },
    };
    const pack: Entity = {
      ...common,
      id: pid,
      kind: "package",
      parent_id: cid,
      data: {
        status: "draft",
        content_id: cid,
        content_version: 1,
        draft_id: "",
        draft_revision: 0,
        brand_id: "",
        brand_version: 0,
        platform: "instagram",
        caption: r.caption,
        title: r.title,
        cta: "",
        thread: [],
        source_links: [r.source_url],
        media_id: null,
        duration: 0,
        aspect: "4:5",
        language: "es",
        subtitles: null,
        graphic_ids: [],
        fingerprint: archive.sha256,
        imported,
      },
    };
    await rpc("commit_control", {
      p_epoch: state.epoch,
      p_entities: [content, pack],
      p_jobs: [],
      p_public: [],
      p_actor: "newsroom-executor:private-staging",
    });
  }
  const candidate = await createCandidate(rpc, pid, null, true);
  // Completion must retain the candidate before email. Retries reuse the exact package/candidate.
  await rpc("finish_control_job", {
    p_id: job.id,
    p_token: job.lease_token,
    p_status: "succeeded",
    p_result: {
      candidate_id: candidate.id,
      checksum: candidate.data.checksum,
      media: r.media,
      metrics: r.metrics,
    },
    p_error: null,
    p_retryable: false,
  });
  const notification = await deliverReviewNotifications(
    rpc,
    true,
    fetch,
    candidate.id,
  );
  return {
    candidate_id: candidate.id,
    review_url: `/review/${candidate.id}`,
    state: candidate.data.state,
    publication_eligible: false,
    notification,
  };
}
