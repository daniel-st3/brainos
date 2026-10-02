import { ProviderError } from "../providers/client";
import { publicAttribution } from "../providers/attribution";
import { randomUUID } from "node:crypto";
import type { Rpc } from "../ingestion/store";
import type { Story } from "../domain/types";
import { studio } from "../production/service";
import type { StudioState } from "../production/types";
import { controlCommand } from "./commands";
import {
  platforms,
  defaultRules,
  quality,
  transition,
  exactDraft,
  fresh,
  approvedTake,
  productionIssues,
  packageFingerprint,
  hash,
  risk,
  baseline,
  type Entity,
  type ControlState,
  type Content,
  type Brand,
  type Package,
  type Account,
  type Job,
  type Kind,
} from "./model";
import { providerAdapter } from "./providers";
import {
  renderGraphic,
  clearGraphicOutputs,
  type GraphicInput,
} from "./graphics";
export async function readControl(rpc: Rpc, demo: boolean) {
  const s = (await rpc("read_control")) as ControlState;
  return {
    ...s,
    entities: s.entities.filter((e) => e.is_demo === demo),
    jobs: s.jobs.filter((j) => j.is_demo === demo),
  };
}
export async function controlSnapshot(rpc: Rpc, demo: boolean) {
  const [state, allStories, production] = await Promise.all([
    readControl(rpc, demo),
    rpc("read_newsroom") as Promise<Story[]>,
    studio(rpc),
  ]);
  const stories = allStories.filter((s) => s.is_demo === demo),
    ids = new Set(stories.map((s) => s.id)),
    packages = production.packages.filter((p) => ids.has(p.story_id)),
    pids = new Set(packages.map((p) => p.id));
  state.entities = state.entities.map((e) => {
    if (e.kind !== "content") return e;
    const c = e as unknown as Entity<Content>;
    if (c.data.format !== "video") return e;
    const p = packages.find((p) => p.id === c.data.production_id),
      job = production.jobs.find(
        (j) =>
          j.package_id === p?.id && ["queued", "running"].includes(j.status),
      );
    const stage = !p
      ? "recording_needed"
      : !p.valid
        ? "revision_mismatch"
        : job?.kind === "transcribe"
          ? "transcribing"
          : job?.kind === "render"
            ? "rendering"
            : p.data.state === "approved"
              ? "final_approved"
              : p.data.state === "review"
                ? "final_review"
                : p.data.state;
    return { ...e, data: { ...e.data, production_state: stage } };
  });
  return {
    state,
    stories,
    production: {
      packages,
      jobs: production.jobs.filter((j) => pids.has(j.package_id)),
      batches: production.batches.filter((b) =>
        b.package_ids.every((id) => pids.has(id)),
      ),
    },
  };
}
export function activeBrand(state: ControlState) {
  return state.entities.find(
    (e) => e.kind === "brand" && e.data.status === "active",
  ) as Entity<Brand> | undefined;
}
export function accounts(state: ControlState) {
  return platforms.map((platform) => {
    const e = state.entities.find(
      (e) => e.kind === "account" && e.data.platform === platform,
    ) as Entity<Account> | undefined;
    return {
      id: e?.id ?? null,
      platform,
      status: e?.data.status ?? "not_created",
      handle: e?.data.handle ?? "",
      capabilities: e?.data.capabilities ?? [],
      reason:
        e?.data.reason ?? "Create the account, then authorize its provider",
    };
  });
}
export function editorialContext(
  state: ControlState,
  topic: string,
  platform: string,
) {
  const brand = activeBrand(state);
  if (!brand) throw Error("Active human-approved brand revision required");
  return {
    brand_id: brand.id,
    brand_version: brand.version,
    language: brand.data.language,
    positioning: brand.data.positioning,
    tone: brand.data.tone,
    pillars: brand.data.pillars,
    platform,
    rules: brand.data.rules,
    approved_takes: state.entities
      .filter(
        (e) =>
          e.kind === "take" &&
          e.data.status === "approved" &&
          e.data.topic === topic,
      )
      .slice(0, 5)
      .map((e) => ({
        id: e.id,
        text: e.data.text,
        approved_at: e.data.approved_at,
      })),
    links: state.entities
      .filter((e) => e.kind === "link" && e.data.status === "approved")
      .map((e) => ({ title: e.data.title, url: e.data.url })),
  };
}
function find<T = Record<string, unknown>>(
  state: ControlState,
  id: string,
  kind: Kind,
) {
  const e = state.entities.find((e) => e.id === id && e.kind === kind);
  if (!e) throw Error(`${kind} record missing`);
  return e as Entity<T>;
}
function graphicsFor(state: ControlState, p: Package) {
  return p.graphic_ids.map((id) => find(state, id, "graphic"));
}
export function readiness(
  content: Entity<Content>,
  state: ControlState,
  stories: Story[],
  production: StudioState,
  packageId?: string,
) {
  const issues: string[] = [];
  let draft;
  try {
    draft = exactDraft(content, stories).draft;
  } catch (e) {
    issues.push((e as Error).message);
  }
  if (content.data.content_state !== "approved")
    issues.push("Content approval required");
  if (!fresh(content.data))
    issues.push("CLAIMS_CURRENT · news needs revalidation");
  if (!activeBrand(state)) issues.push("Approved brand required");
  if (
    draft &&
    stories
      .find((s) => s.id === content.story_id)
      ?.angles.find((a) => a.id === draft.angle_id)?.kind === "opinion" &&
    !approvedTake(content.data, state)
  )
    issues.push("Approved Daniel take required");
  issues.push(...productionIssues(content, production, state));
  if (content.data.format === "video") {
    const output = production.packages.find(
      (p) => p.id === content.data.production_id,
    )?.data.output;
    if (output && output.options.layout !== "vertical")
      issues.push("Short-video package requires verified vertical 9:16 output");
    if (output && output.duration > 180)
      issues.push(
        "Short-form output exceeds the conservative 180-second package limit",
      );
  }
  const pkg = packageId
    ? (state.entities.find(
        (e) => e.id === packageId && e.kind === "package",
      ) as Entity<Package> | undefined)
    : (state.entities.find(
        (e) =>
          e.kind === "package" &&
          e.parent_id === content.id &&
          e.data.status === "approved",
      ) as Entity<Package> | undefined);
  if (!pkg || pkg.data.status !== "approved")
    issues.push("Exact platform package approval required");
  if (pkg && draft) {
    const brand = activeBrand(state);
    if (
      !brand ||
      pkg.data.brand_id !== brand.id ||
      pkg.data.brand_version !== brand.version
    )
      issues.push("Package brand revision changed");
    const g = graphicsFor(state, pkg.data);
    if (
      g.some(
        (asset) =>
          asset.data.template === "cover" &&
          String((asset.data.input as GraphicInput).headline) !==
            pkg.data.title,
      )
    )
      issues.push(
        "Cover headline differs from this platform revision; regenerate the cover",
      );
    if (
      g.some(
        (g) =>
          g.data.rights !== "cleared" ||
          g.data.publishable !== true ||
          g.data.content_revision !== content.data.draft_revision ||
          !String(g.data.scope).split(",").includes(content.data.platform),
      )
    )
      issues.push("Graphic revision/rights unresolved");
    if (
      pkg.data.fingerprint !== packageFingerprint(content, draft, production, g)
    )
      issues.push("Platform package is stale");
    try {
      providerAdapter(content.data.platform).validatePackage(pkg.data);
    } catch (e) {
      issues.push((e as Error).message);
    }
  }
  return { issues, package: pkg, ready: issues.length === 0 };
}
export function launchReadiness(
  campaign: Entity,
  state: ControlState,
  stories: Story[],
  production: StudioState,
) {
  return (campaign.data.content_ids as string[]).map((id) => {
    const c = find<Content>(state, id, "content"),
      r = readiness(c, state, stories, production),
      a = accounts(state).find((a) => a.platform === c.data.platform)!;
    return {
      id,
      title: c.data.title,
      issues: [
        ...r.issues,
        ...(a.status !== "connected" ? [`${a.platform}: ${a.status}`] : []),
        ...(!c.data.final_approval ? ["Final content approval required"] : []),
      ],
      ready: r.ready && a.status === "connected" && !!c.data.final_approval,
    };
  });
}
export function actions(
  state: ControlState,
  stories: Story[],
  production: StudioState,
) {
  return [
    ...stories
      .filter((s) => !s.archived)
      .flatMap((s) => [
        ...s.angles
          .filter((a) => a.approval_state === "suggested")
          .map((a) => ({
            id: a.id,
            title: "Approve angle",
            detail: s.title,
            href: `/stories/${s.id}?tab=angles`,
            kind: "angle",
          })),
        ...s.drafts
          .filter((d) => d.status === "draft" && d.id === s.active_draft_id)
          .map((d) => ({
            id: d.id,
            title: "Review script",
            detail: `${s.title} · r${d.revision}`,
            href: `/stories/${s.id}?tab=drafts`,
            kind: "script",
          })),
      ]),
    ...production.packages
      .filter((p) => p.valid && p.data.state !== "approved")
      .map((p) => ({
        id: p.id,
        title:
          p.data.state === "review" || p.data.state === "rendered"
            ? "Review final render"
            : "Production task",
        detail: `${p.data.title} · ${p.data.state}`,
        href: `/production/studio?package=${p.id}`,
        kind: "production",
      })),
    ...state.entities
      .filter(
        (e) =>
          (e.kind === "take" && e.data.status === "suggested") ||
          (e.kind === "brand" && e.data.status === "draft") ||
          (e.kind === "newsletter" && e.data.status === "review") ||
          (e.kind === "package" && e.data.status === "draft"),
      )
      .map((e) => ({
        id: e.id,
        title: `Review ${e.kind}`,
        detail: String(e.data.title ?? e.data.name ?? e.data.text),
        href: `/workbench?tab=${e.kind === "package" ? "content" : e.kind === "take" ? "takes" : e.kind}`,
        kind: e.kind,
      })),
    ...state.jobs
      .filter((j) => ["blocked", "failed", "dead_letter"].includes(j.status))
      .map((j) => ({
        id: j.id,
        title: `${j.kind} job ${j.status}`,
        detail: j.error ?? "Review before retry",
        href: "/workbench?tab=operations",
        kind: "job",
      })),
  ];
}
export async function controlAction(
  rpc: Rpc,
  raw: unknown,
  actor: string,
  demo: boolean,
  expectedEpoch?: number,
): Promise<{ id?: string | null; epoch?: number; processed?: string[] }> {
  const command = controlCommand.parse(raw);
  if (!actor || actor === "local-worker") throw Error("Human editor required");
  const { state, stories, production } = await controlSnapshot(rpc, demo);
  if (expectedEpoch !== undefined && expectedEpoch !== state.epoch)
    throw Error("Conflict: refresh the workbench");
  if (command.action === "job_retry" || command.action === "job_cancel") {
    if (!state.jobs.some((j) => j.id === command.id))
      throw Error("Job missing");
    await rpc("recover_control_job", {
      p_id: command.id,
      p_cancel: command.action === "job_cancel",
    });
    return { id: command.id };
  }
  if (
    command.action === "graphics_process" ||
    command.action === "analytics_process" ||
    command.action === "distribution_process"
  )
    return processJobs(
      rpc,
      command.action === "graphics_process"
        ? "graphic"
        : command.action === "distribution_process"
          ? "distribution"
          : "analytics",
      demo,
    );
  const changed = new Map<string, Entity>(),
    jobs: Job[] = [],
    pub: Record<string, unknown>[] = [],
    now = new Date().toISOString();
  let resultId: string | null = null;
  const put = <T>(
    kind: Kind,
    data: T,
    old?: Entity<T>,
    links: {
      story_id?: string | null;
      draft_id?: string | null;
      parent_id?: string | null;
    } = {},
  ) => {
    const e = {
      id: old?.id ?? randomUUID(),
      kind,
      version: (old?.version ?? 0) + 1,
      story_id: links.story_id ?? old?.story_id ?? null,
      draft_id: links.draft_id ?? old?.draft_id ?? null,
      parent_id: links.parent_id ?? old?.parent_id ?? null,
      is_demo: demo,
      data,
    } as Entity<T>;
    changed.set(e.id, e as Entity);
    const idx = state.entities.findIndex((x) => x.id === e.id);
    if (idx >= 0) state.entities[idx] = e as Entity;
    else state.entities.push(e as Entity);
    resultId = e.id;
    return e;
  };
  const queue = (
    kind: Job["kind"],
    e: Entity<unknown>,
    key: string,
    input: Record<string, unknown>,
    due = now,
    blocked: string | null = null,
  ) =>
    jobs.push({
      id: randomUUID(),
      kind,
      entity_id: e.id,
      entity_version: e.version,
      is_demo: demo,
      idempotency_key: key,
      status: blocked ? "blocked" : "queued",
      due_at: due,
      input,
      error: blocked,
      retryable: !!blocked,
    });
  const content = (id: string) => find<Content>(state, id, "content"),
    pkg = (id: string) => find<Package>(state, id, "package");
  const requireReady = (c: Entity<Content>, id?: string) => {
    const r = readiness(c, state, stories, production, id);
    if (!r.ready) throw Error(r.issues.join("; "));
    return r;
  };
  const invalidate = (c: Entity<Content>) => {
    for (const p of state.entities.filter(
      (e) =>
        e.kind === "package" &&
        e.parent_id === c.id &&
        e.data.status === "approved",
    ))
      put("package", { ...p.data, status: "invalidated" }, p);
  };
  switch (command.action) {
    case "brand_save": {
      const prior = activeBrand(state);
      put<Brand>(
        "brand",
        {
          status: "draft",
          name: command.name,
          language: "es",
          secondary_language: "Only when explicitly requested",
          positioning: command.positioning,
          audience: command.audience,
          pillars: command.pillars,
          tone: command.tone,
          visual: [
            "Editorial typography",
            "Neutral paper",
            "Evidence attribution",
          ],
          rules: command.banned_patterns?.length
            ? command.banned_patterns.map((pattern, i) => {
                new RegExp(pattern, "giu");
                return {
                  id: `custom_${i + 1}`,
                  pattern,
                  severity: "medium" as const,
                  remediation: "Rewrite in Daniel’s direct, evidence-led voice",
                };
              })
            : (prior?.data.rules ?? defaultRules),
          cta: command.cta,
        },
        undefined,
        { parent_id: prior?.id },
      );
      break;
    }
    case "brand_approve": {
      const b = find<Brand>(state, command.id, "brand");
      if (b.data.status !== "draft") throw Error("Draft brand required");
      for (const prev of state.entities.filter(
        (e) => e.kind === "brand" && e.data.status === "active",
      ))
        put("brand", { ...prev.data, status: "superseded" }, prev);
      put(
        "brand",
        { ...b.data, status: "active", approved_by: actor, approved_at: now },
        b,
      );
      break;
    }
    case "idea_create": {
      if (command.story_id && !stories.some((s) => s.id === command.story_id))
        throw Error("Story missing");
      put(
        "idea",
        {
          title: command.title,
          status: "captured",
          source: command.source,
          provenance: command.provenance,
          originality: command.originality,
          created_by: actor,
          created_at: now,
        },
        undefined,
        { story_id: command.story_id },
      );
      break;
    }
    case "idea_transition": {
      const e = find(state, command.id, "idea");
      if (
        command.target === "qualified" &&
        e.data.source === "competitor" &&
        !String(e.data.originality).trim()
      )
        throw Error("Competitor idea needs an originality note");
      put(
        "idea",
        {
          ...e.data,
          status: transition("idea", String(e.data.status), command.target),
        },
        e,
      );
      break;
    }
    case "content_create": {
      const idea = find(state, command.idea_id, "idea");
      if (idea.data.status !== "selected")
        throw Error("Select the qualified idea first");
      const brand = activeBrand(state);
      if (!brand) throw Error("Approved brand required");
      const story = stories.find((s) => s.id === idea.story_id);
      put<Content>(
        "content",
        {
          title: String(idea.data.title),
          pillar: story?.pillar ?? brand.data.pillars[0],
          purpose: command.purpose,
          platform: command.platform,
          format: command.format,
          language: brand.data.language,
          angle_id: null,
          take_id: null,
          owner: actor,
          content_state: "planned",
          production_state:
            command.format === "video" ? "recording_needed" : "not_required",
          distribution_state: "not_ready",
          analytics_state: "pending",
          draft_revision: null,
          production_id: null,
          fresh_until: null,
          evergreen: false,
          claims_reviewed_at: null,
          revalidation_required: true,
          final_approval: null,
          quality_issues: [],
        },
        undefined,
        { story_id: idea.story_id, parent_id: idea.id },
      );
      break;
    }
    case "content_bind": {
      const c = content(command.id),
        s = stories.find((s) => s.id === c.story_id),
        d = s?.drafts.find((d) => d.id === command.draft_id);
      if (!s || !d) throw Error("Draft must belong to this content's story");
      if (
        command.production_id &&
        !production.packages.some(
          (p) =>
            p.id === command.production_id && p.draft_id === d.id && p.valid,
        )
      )
        throw Error("Production must match exact draft");
      invalidate(c);
      put(
        "content",
        {
          ...c.data,
          angle_id: d.angle_id,
          draft_revision: d.revision,
          production_id: command.production_id ?? null,
          content_state: "draft_ready",
          distribution_state: "not_ready",
          final_approval: null,
          quality_issues: quality(
            `${d.hook}\n${d.body}\n${d.cta}`,
            activeBrand(state)?.data.rules,
          ),
        },
        c,
        { draft_id: d.id },
      );
      break;
    }
    case "content_transition": {
      const c = content(command.id);
      transition("content", c.data.content_state, command.target);
      if (command.target === "approved") {
        if (!command.confirmed) throw Error("Explicit approval required");
        const { draft, story } = exactDraft(c, stories);
        if (!fresh(c.data))
          throw Error("News must be revalidated before approval");
        if (
          story.angles.find((a) => a.id === draft.angle_id)?.kind ===
            "opinion" &&
          !approvedTake(c.data, state)
        )
          throw Error("Opinion requires an approved Daniel take");
      }
      invalidate(c);
      put(
        "content",
        {
          ...c.data,
          content_state: command.target,
          final_approval: null,
          distribution_state: "not_ready",
          status: command.target === "approved" ? "approved" : "draft",
        },
        c,
      );
      break;
    }
    case "content_freshness": {
      const c = content(command.id);
      if (!command.evergreen && !command.fresh_until)
        throw Error("News freshness deadline required");
      invalidate(c);
      put(
        "content",
        {
          ...c.data,
          evergreen: command.evergreen,
          fresh_until: command.fresh_until,
          revalidation_required: !command.evergreen,
          final_approval: null,
          distribution_state: "not_ready",
        },
        c,
      );
      break;
    }
    case "claim_revalidate": {
      const c = content(command.id),
        s = stories.find((s) => s.id === c.story_id);
      if (
        !s ||
        command.source_ids.some((id) => !s.sources.some((s) => s.id === id))
      )
        throw Error("Retained evidence sources required");
      if (
        !c.data.evergreen &&
        (!c.data.fresh_until || Date.parse(c.data.fresh_until) <= Date.now())
      )
        throw Error("Set a future freshness deadline first");
      put(
        "review",
        {
          type: "claim_revalidation",
          notes: command.notes,
          source_ids: command.source_ids,
          risk: risk(s.claims.map((c) => c.text).join(" ")),
          actor,
          at: now,
        },
        undefined,
        { parent_id: c.id, story_id: s.id, draft_id: c.draft_id },
      );
      put(
        "content",
        { ...c.data, claims_reviewed_at: now, revalidation_required: false },
        c,
      );
      break;
    }
    case "take_suggest":
      put(
        "take",
        {
          status: "suggested",
          text: command.text,
          topic: command.topic,
          rationale: command.rationale,
          source_ids: command.source_ids,
          created_by: actor,
          created_at: now,
          approved_by: null,
          approved_at: null,
        },
        undefined,
        { story_id: command.story_id },
      );
      break;
    case "take_decide": {
      const t = find(state, command.id, "take");
      if (
        (command.decision === "superseded" && t.data.status !== "approved") ||
        (command.decision !== "superseded" && t.data.status !== "suggested")
      )
        throw Error("Invalid take decision");
      put(
        "take",
        {
          ...t.data,
          status: command.decision,
          reason: command.reason,
          approved_by: command.decision === "approved" ? actor : null,
          approved_at: command.decision === "approved" ? now : null,
        },
        t,
      );
      break;
    }
    case "content_take": {
      const c = content(command.id),
        t = find(state, command.take_id, "take");
      if (t.data.status !== "approved")
        throw Error("Suggested takes are not Daniel's opinions");
      invalidate(c);
      put(
        "content",
        {
          ...c.data,
          take_id: t.id,
          final_approval: null,
          distribution_state: "not_ready",
        },
        c,
      );
      break;
    }
    case "story_reject": {
      if (!stories.some((s) => s.id === command.story_id))
        throw Error("Story missing");
      put(
        "decision",
        {
          status: "editorially_rejected",
          reason: command.reason,
          actor,
          at: now,
          system_failure: false,
        },
        undefined,
        { story_id: command.story_id },
      );
      break;
    }
    case "account_create": {
      const prev = state.entities.find(
        (e) => e.kind === "account" && e.data.platform === command.platform,
      ) as Entity<Account> | undefined;
      put<Account>(
        "account",
        {
          platform: command.platform,
          status: "auth_required",
          handle: command.handle,
          external_id: null,
          capabilities: [],
          verified_at: null,
          reason:
            "Account declared created by Daniel; credentials and capability verification required",
        },
        prev,
      );
      break;
    }
    case "account_revoke": {
      const a = find<Account>(state, command.id, "account");
      put(
        "account",
        {
          ...a.data,
          status: "revoked",
          capabilities: [],
          verified_at: null,
          reason: "Human revoked connection",
        },
        a,
      );
      break;
    }
    case "package_create": {
      const c = content(command.id),
        { story, draft } = exactDraft(c, stories),
        brand = activeBrand(state);
      if (!brand) throw Error("Approved brand required");
      const gs = command.graphic_ids.map((id) => find(state, id, "graphic"));
      if (gs.some((g) => g.parent_id !== c.id))
        throw Error("Graphic belongs to another content item");
      const p: Package = {
        status: "draft",
        content_id: c.id,
        content_version: c.version,
        draft_id: draft.id,
        draft_revision: draft.revision,
        brand_id: brand.id,
        brand_version: brand.version,
        platform: c.data.platform,
        caption: command.caption,
        privacy: command.privacy,
        title: command.title,
        cta: command.cta,
        thread: command.thread,
        source_links: publicAttribution(story, c.data.platform).links,
        attribution: publicAttribution(story, c.data.platform),
        duration:
          production.packages.find((p) => p.id === c.data.production_id)?.data
            .output?.duration ?? null,
        aspect:
          production.packages.find((p) => p.id === c.data.production_id)?.data
            .output?.options.layout === "vertical"
            ? "9:16"
            : production.packages.find((p) => p.id === c.data.production_id)
                  ?.data.output
              ? "original"
              : null,
        language: c.data.language,
        media_id:
          production.packages.find((p) => p.id === c.data.production_id)?.data
            .output?.file_id ?? null,
        subtitles:
          production.packages.find((p) => p.id === c.data.production_id)?.data
            .output?.subtitles?.srt ?? null,
        graphic_ids: command.graphic_ids,
        fingerprint: packageFingerprint(c, draft, production, gs),
      };
      providerAdapter(p.platform).validatePackage(p);
      put("package", p, undefined, {
        parent_id: c.id,
        story_id: c.story_id,
        draft_id: draft.id,
      });
      break;
    }
    case "package_approve": {
      const p = pkg(command.id),
        c = content(p.parent_id!),
        { draft } = exactDraft(c, stories);
      if (p.data.status !== "draft")
        throw Error("Unapproved package revision required");
      if (
        p.data.fingerprint !==
        packageFingerprint(c, draft, production, graphicsFor(state, p.data))
      )
        throw Error("Package changed; regenerate before approval");
      providerAdapter(p.data.platform).validatePackage(p.data);
      put(
        "package",
        { ...p.data, status: "approved", approved_by: actor, approved_at: now },
        p,
      );
      break;
    }
    case "graphic_queue": {
      const c = content(command.content_id);
      exactDraft(c, stories);
      const g = put(
        "graphic",
        {
          status: "queued",
          template: command.template,
          template_version: 1,
          input: command,
          content_revision: c.data.draft_revision,
          rights: "unknown",
          publishable: false,
          created_by: actor,
          created_at: now,
        },
        undefined,
        { parent_id: c.id, story_id: c.story_id, draft_id: c.draft_id },
      );
      queue("graphic", g, `graphic:${g.id}:1`, {
        input: command,
        content_version: c.version,
        draft_revision: c.data.draft_revision,
      });
      break;
    }
    case "graphic_clear": {
      const g = find(state, command.id, "graphic");
      if (g.data.status !== "rendered" || !g.data.sha256)
        throw Error("Render the asset before reviewing rights");
      const cleared = put(
        "graphic",
        {
          ...g.data,
          rights: "cleared",
          publishable: true,
          ...clearGraphicOutputs(
            g.data.outputs as {
              svg: string;
              sha256: string;
              [key: string]: unknown;
            }[],
            { basis: command.basis, scope: command.scope, actor, at: now },
          ),
          basis: command.basis,
          scope: command.scope,
          cleared_by: actor,
          cleared_at: now,
        },
        g,
      );
      queue("graphic", cleared, `raster:${cleared.id}:${cleared.version}`, {
        stage: "raster",
        draft_revision: g.data.content_revision,
      });
      break;
    }
    case "content_final": {
      const c = content(command.id),
        r = requireReady(c, command.package_id);
      put(
        "content",
        {
          ...c.data,
          distribution_state: "ready",
          production_state:
            c.data.format === "video" ? "final_approved" : "not_required",
          final_approval: {
            actor,
            at: now,
            fingerprint: r.package!.data.fingerprint,
            package_id: r.package!.id,
            package_version: r.package!.version,
          },
        },
        c,
      );
      break;
    }
    case "distribution_queue": {
      const p = pkg(command.package_id),
        c = content(p.parent_id!),
        r = requireReady(c, p.id);
      if (
        c.data.final_approval?.fingerprint !== r.package!.data.fingerprint ||
        c.data.final_approval?.package_id !== p.id ||
        c.data.final_approval?.package_version !== p.version
      )
        throw Error("Exact final approval required");
      const account = accounts(state).find(
        (a) => a.platform === p.data.platform,
      )!;
      const reason =
        account.status !== "connected"
          ? `${p.data.platform}: ${account.status}; authorization required`
          : !account.capabilities.includes("publish")
            ? "PUBLISH_CAPABILITY_UNAVAILABLE"
            : null;
      queue(
        "distribution",
        p,
        `distribution:${p.id}:${p.version}`,
        { content_id: c.id, package_id: p.id, fingerprint: p.data.fingerprint },
        command.due_at,
        reason,
      );
      put("content", { ...c.data, distribution_state: "scheduled" }, c);
      break;
    }
    case "publication_record":
    case "publication_demo": {
      if (command.action === "publication_record") {
        if (Date.parse(command.published_at) > Date.now())
          throw Error("Actual publication timestamp cannot be in the future");
        const host = new URL(command.url).hostname;
        const platform = pkg(command.package_id).data.platform;
        const domains: Record<string, string[]> = {
          x: ["x.com", "twitter.com"],
          instagram: ["instagram.com"],
          tiktok: ["tiktok.com"],
          youtube: ["youtube.com", "youtu.be"],
          beehiiv: ["beehiiv.com"],
        };
        if (
          !domains[platform].some((d) => host === d || host.endsWith("." + d))
        )
          throw Error("Publication URL must match the selected provider");
      }
      if (command.action === "publication_demo" && !demo)
        throw Error("Simulated publication is restricted to demo workspace");
      const p = pkg(command.package_id),
        c = content(p.parent_id!),
        r = requireReady(c, p.id);
      if (
        c.data.final_approval?.fingerprint !== r.package!.data.fingerprint ||
        c.data.final_approval?.package_id !== p.id ||
        c.data.final_approval?.package_version !== p.version
      )
        throw Error("Final approval required");
      if (
        state.entities.some(
          (e) =>
            e.kind === "publication" &&
            e.data.package_id === p.id &&
            e.data.package_version === p.version,
        )
      )
        throw Error("Publication already recorded; idempotency protected");
      const publication = put(
        "publication",
        {
          status: "published",
          simulated: command.action === "publication_demo",
          package_id: p.id,
          package_version: p.version,
          content_id: c.id,
          platform: p.data.platform,
          published_at:
            command.action === "publication_record"
              ? command.published_at
              : now,
          public_url:
            command.action === "publication_record" ? command.url : null,
          dimensions: {
            platform: c.data.platform,
            pillar: c.data.pillar,
            format: c.data.format,
            language: c.data.language,
          },
          metrics: [],
          raw_snapshots: [],
        },
        undefined,
        { parent_id: c.id, story_id: c.story_id, draft_id: c.draft_id },
      );
      for (const hours of [24, 72, 168])
        queue(
          "analytics",
          publication,
          `analytics:${publication.id}:${hours}`,
          { publication_id: publication.id, hours },
          new Date(
            Date.parse(
              command.action === "publication_record"
                ? command.published_at
                : now,
            ) +
              hours * 3600000,
          ).toISOString(),
        );
      put(
        "content",
        {
          ...c.data,
          distribution_state: "published",
          analytics_state: "scheduled",
        },
        c,
      );
      resultId = publication.id;
      break;
    }
    case "metrics_record": {
      const p = find(state, command.publication_id, "publication");
      const snapshot = {
        measured_at: now,
        source: "human_supplied",
        is_demo: demo,
        metrics: command.metrics,
        raw: command.raw,
        actor,
      };
      put(
        "publication",
        {
          ...p.data,
          raw_snapshots: [
            ...((p.data.raw_snapshots as unknown[]) ?? []),
            snapshot,
          ],
        },
        p,
      );
      const c = content(p.parent_id!);
      put("content", { ...c.data, analytics_state: "measured" }, c);
      break;
    }
    case "performance_review": {
      const p = find(state, command.id, "publication"),
        snaps = (p.data.raw_snapshots ??
          (
            p.data.metrics as { values: Record<string, number> }[] | undefined
          )?.map((m) => ({ metrics: m.values })) ??
          []) as { metrics: Record<string, number> }[];
      if (!snaps.length) throw Error("Measured metrics required");
      const peers = state.entities.filter(
        (e) =>
          e.kind === "publication" &&
          e.id !== p.id &&
          hash(e.data.dimensions ?? e.data.content_dimensions) ===
            hash(p.data.dimensions ?? p.data.content_dimensions) &&
          e.data.simulated === p.data.simulated,
      );
      const latest = snaps.at(-1)!.metrics;
      const comparisons = Object.fromEntries(
        Object.entries(latest).map(([metric, value]) => [
          metric,
          baseline(
            peers.flatMap((e) => {
              const snapshots = (e.data.raw_snapshots ??
                (
                  e.data.metrics as
                    { values: Record<string, number> }[] | undefined
                )?.map((m) => ({ metrics: m.values })) ??
                []) as { metrics: Record<string, number> }[];
              const v = snapshots.at(-1)?.metrics[metric];
              return v === undefined ? [] : [v];
            }),
            value,
          ),
        ]),
      );
      put(
        "review",
        {
          type: "performance",
          notes: command.notes,
          comparisons,
          publication_id: p.id,
          actor,
          at: now,
          causality: false,
        },
        undefined,
        { parent_id: p.id },
      );
      const c = content(p.parent_id!);
      put("content", { ...c.data, analytics_state: "reviewed" }, c);
      put(
        "idea",
        {
          title: `Follow-up: ${c.data.title}`,
          source: "analytics",
          status: "captured",
          provenance: `Human review of publication ${p.id}: ${command.notes}`,
          originality: "",
          created_by: actor,
          created_at: now,
        },
        undefined,
        { story_id: c.story_id, parent_id: p.id },
      );
      break;
    }
    case "experiment_create":
      put(
        "experiment",
        {
          name: command.name,
          hypothesis: command.hypothesis,
          arms: command.arms,
          metric: command.metric,
          assignments: [],
          status: "planning",
          causality: false,
          created_by: actor,
        },
        undefined,
      );
      break;
    case "experiment_assign": {
      const e = find(state, command.id, "experiment");
      content(command.content_id);
      if (!(e.data.arms as string[]).includes(command.arm))
        throw Error("Unknown experiment arm");
      const assignments = e.data.assignments as {
        content_id: string;
        arm: string;
      }[];
      if (assignments.some((a) => a.content_id === command.content_id))
        throw Error("Content already assigned");
      put(
        "experiment",
        {
          ...e.data,
          status: "running",
          assignments: [
            ...assignments,
            { content_id: command.content_id, arm: command.arm },
          ],
        },
        e,
      );
      break;
    }
    case "experiment_review": {
      const e = find(state, command.id, "experiment");
      put(
        "experiment",
        {
          ...e.data,
          status: "reviewed",
          conclusion: command.notes,
          reviewed_by: actor,
          reviewed_at: now,
          sample_size: (e.data.assignments as unknown[]).length,
          warning:
            "Observational results; small samples do not establish causality",
        },
        e,
      );
      break;
    }
    case "campaign_create": {
      command.content_ids.forEach(content);
      put("campaign", {
        name: command.name,
        content_ids: command.content_ids,
        created_by: actor,
        created_at: now,
      });
      break;
    }
    case "newsletter_create": {
      const sections = command.package_ids.map((id, position) => {
        const p = pkg(id);
        if (p.data.platform !== "beehiiv" || p.data.status !== "approved")
          throw Error("Approved newsletter platform sections required");
        return {
          position,
          package_id: p.id,
          package_version: p.version,
          content_id: p.parent_id,
          copy: p.data.caption,
          source_links: p.data.source_links,
        };
      });
      put("newsletter", {
        status: "drafting",
        title: command.title,
        opening: command.opening,
        sections,
        revision: 1,
        approved_by: null,
        approved_at: null,
        provider_state: "not_created",
      });
      break;
    }
    case "newsletter_revise": {
      const e = find(state, command.id, "newsletter");
      put(
        "newsletter",
        {
          ...e.data,
          status: "drafting",
          title: command.title,
          opening: command.opening,
          revision: Number(e.data.revision) + 1,
          approved_by: null,
          approved_at: null,
        },
        undefined,
        { parent_id: e.id },
      );
      break;
    }
    case "newsletter_review": {
      const e = find(state, command.id, "newsletter");
      put(
        "newsletter",
        {
          ...e.data,
          status: transition("newsletter", String(e.data.status), "review"),
        },
        e,
      );
      break;
    }
    case "newsletter_approve": {
      const e = find(state, command.id, "newsletter");
      transition("newsletter", String(e.data.status), "approved");
      for (const section of e.data.sections as {
        package_id: string;
        package_version: number;
      }[]) {
        const p = pkg(section.package_id);
        if (p.version !== section.package_version)
          throw Error("Newsletter section revision changed");
        requireReady(content(p.parent_id!), p.id);
      }
      put(
        "newsletter",
        {
          ...e.data,
          status: "approved",
          approved_by: actor,
          approved_at: now,
          approved_revision: e.data.revision,
        },
        e,
      );
      break;
    }
    case "link_create":
      put("link", {
        title: command.title,
        url: command.url,
        status: "approved",
        approved_by: actor,
        approved_at: now,
      });
      break;
    case "question_create":
      put("question", {
        text: command.text,
        source: command.source,
        consent_at: now,
        recorded_by: actor,
        status: "captured",
      });
      break;
    case "materialize_public": {
      const source = state.entities.find((e) => e.id === command.id);
      if (!source) throw Error("Public source missing");
      if (
        (command.kind === "profile" && source.kind !== "brand") ||
        (command.kind === "link" && source.kind !== "link") ||
        (["content", "build"].includes(command.kind) &&
          source.kind !== "content")
      )
        throw Error("Public kind/source mismatch");
      if (source.kind === "content") {
        const c = source as unknown as Entity<Content>;
        requireReady(c);
        if (!c.data.final_approval)
          throw Error("Final approved public content required");
        const finalPackage = find<Package>(
          state,
          c.data.final_approval.package_id,
          "package",
        );
        requireReady(c, finalPackage.id);
        if (
          finalPackage.version !== c.data.final_approval.package_version ||
          finalPackage.data.fingerprint !== c.data.final_approval.fingerprint
        )
          throw Error("Public output approval is stale");
      }
      if (
        !["active", "approved", "published"].includes(
          String(source.data.status),
        )
      )
        throw Error("Explicitly approved source required");
      if (
        command.url &&
        /drive\.google\.com|docs\.google\.com/.test(
          new URL(command.url).hostname,
        )
      )
        throw Error("Private Drive internals cannot become public links");
      pub.push({
        id: source.id,
        kind: command.kind,
        title: command.title,
        description: command.description,
        body: command.body,
        url: command.url,
        approved_by: actor,
        approved_at: now,
        source_id: source.id,
        source_version: source.version,
        is_demo: demo,
        visible: true,
      });
      resultId = source.id;
      break;
    }
  }
  await rpc("commit_control", {
    p_epoch: state.epoch,
    p_entities: [...changed.values()],
    p_jobs: jobs,
    p_public: pub,
    p_actor: actor,
  });
  return { id: resultId, epoch: state.epoch + 1 };
}
export async function processJobs(
  rpc: Rpc,
  kind: "graphic" | "analytics" | "distribution",
  demo: boolean,
) {
  const processed: string[] = [];
  for (let count = 0; count < 10; count++) {
    const job = (await rpc("claim_control_job", {
      p_kind: kind,
      p_demo: demo,
    })) as Job | null;
    if (!job) break;
    try {
      const { state, stories } = await controlSnapshot(rpc, demo);
      const e = find(
        state,
        job.entity_id,
        kind === "graphic"
          ? "graphic"
          : kind === "distribution"
            ? "package"
            : "publication",
      );
      if (kind !== "analytics" && e.version !== job.entity_version)
        throw Error("Job input revision changed");
      if (kind === "distribution") {
        const p = e as unknown as Entity<Package>,
          c = find<Content>(state, p.parent_id!, "content");
        const readinessResult = readiness(
          c,
          state,
          stories,
          await studio(rpc),
          p.id,
        );
        if (!readinessResult.ready)
          throw Error(readinessResult.issues.join("; "));
        if (
          c.data.final_approval?.package_id !== p.id ||
          c.data.final_approval?.package_version !== p.version
        )
          throw Error("Exact final package approval required");
        const account = state.entities.find(
          (a) => a.kind === "account" && a.data.platform === p.data.platform,
        ) as Entity<Account> | undefined;
        const adapter = providerAdapter(p.data.platform, account?.data);
        adapter.validatePackage(p.data);
        const { enqueueOutbox, processOutbox } =
          await import("../providers/outbox");
        const id = await enqueueOutbox(rpc, p.id, job.due_at, demo);
        await rpc("finish_control_job", {
          p_id: job.id,
          p_token: job.lease_token,
          p_status: "succeeded",
          p_result: { outbox_id: id },
          p_error: null,
          p_retryable: false,
        });
        await processOutbox(rpc, demo);
        processed.push(job.id);
        continue;
      }
      if (kind === "analytics") {
        const { captureAnalytics } = await import("../providers/outbox");
        await captureAnalytics(rpc, job, demo);
        processed.push(job.id);
        continue;
      }
      const c = find<Content>(state, e.parent_id!, "content");
      exactDraft(c, stories);
      if (c.data.draft_revision !== job.input.draft_revision)
        throw Error("Graphic draft revision changed");
      const story = stories.find((s) => s.id === c.story_id)!;
      const render =
        job.input.stage === "raster"
          ? e.data
          : renderGraphic(
              story,
              c.id,
              c.data.draft_revision!,
              job.input.input as GraphicInput,
            );
      const { rasterOutputs } = await import("../providers/raster");
      const outputs = await rasterOutputs(
        e.id,
        render.outputs as {
          svg: string;
          sha256: string;
          [key: string]: unknown;
        }[],
        demo,
      );
      const updated = {
        ...e,
        version: e.version + 1,
        data: {
          ...e.data,
          ...render,
          outputs,
          status: "rendered",
          rendered_at: new Date().toISOString(),
        },
      };
      await rpc("commit_control", {
        p_epoch: state.epoch,
        p_entities: [updated],
        p_jobs: [],
        p_public: [],
        p_actor: "graphics-renderer",
        p_lease_id: job.id,
        p_lease_token: job.lease_token,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Job failed";
      await rpc("finish_control_job", {
        p_id: job.id,
        p_token: job.lease_token,
        p_status:
          error instanceof ProviderError && error.retryable
            ? "failed"
            : kind !== "graphic"
              ? "blocked"
              : "failed",
        p_result: {},
        p_error: message,
        p_retryable: kind !== "graphic",
      });
      if (error instanceof ProviderError && error.retryable && !error.uncertain)
        await rpc("reschedule_control_retry", {
          p_id: job.id,
          p_delay: error.retryAfter,
          p_demo: demo,
        });
    }
    processed.push(job.id);
  }
  return { processed };
}
