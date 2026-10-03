import { validatePublicLink } from "../control/public-link";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Rpc } from "../ingestion/store";
import {
  platforms,
  type Brand,
  type Entity,
  type Provider,
  type Content,
} from "../control/model";
import {
  readControl,
  controlAction,
  controlSnapshot,
  readiness,
} from "../control/service";
import { definitions, appConfig } from "./definitions";
import {
  startProviderAuth,
  selectProviderAccount,
  installBeehiiv,
  installBuffer,
  disconnectProvider,
} from "./auth";
const id = z.uuid(),
  short = z.string().trim().min(1).max(200);
export const activationCommand = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("buffer_key"),
    key: z.string().min(10).max(1000),
  }),
  z.object({
    action: z.literal("buffer_delivery"),
    package_id: id,
    mode: z.enum(["draft", "schedule", "queue", "now"]),
    scheduled_at: z.iso.datetime().optional(),
    confirmed: z.literal(true),
  }),
  z.object({
    action: z.literal("auth_start"),
    provider: z.enum(platforms),
    id,
  }),
  z.object({ action: z.literal("select"), id, external_id: short }),
  z.object({
    action: z.literal("beehiiv_key"),
    id,
    key: z.string().min(10).max(1000),
  }),
  z.object({
    action: z.literal("distribution_authorize"),
    id,
    enabled: z.boolean(),
    confirmed: z.literal(true),
  }),
  z.object({ action: z.literal("disconnect"), id, confirmed: z.literal(true) }),
  z.object({
    action: z.literal("created"),
    provider: z.enum(platforms),
    handle: short,
  }),
  z.object({
    action: z.literal("handle"),
    name: short,
    fallbacks: z.array(short).max(5),
    available: z.boolean(),
  }),
  z.object({
    action: z.literal("checklist"),
    id,
    two_factor: z.boolean(),
    recovery_stored: z.boolean(),
    email_strategy: z.string().max(200),
  }),
  z.object({
    action: z.literal("profile_generate"),
    provider: z.enum(platforms),
  }),
  z.object({
    action: z.literal("profile_save"),
    id,
    name: short,
    handle: short,
    bio: z.string().max(1000),
    link: z.url().regex(/^https:\/\//),
    category: short,
  }),
  z.object({
    action: z.literal("profile_approve"),
    id,
    confirmed: z.literal(true),
  }),
  z.object({ action: z.literal("launch_initialize") }),
  z.object({
    action: z.literal("carousel_drive"),
    id,
    confirmed: z.literal(true),
  }),
  z.object({
    action: z.literal("outbox_recover"),
    id,
    operation: z.enum(["retry", "reconcile", "cancel", "resolved"]),
  }),
  z.object({ action: z.literal("job_resolve"), id }),
  z.object({ action: z.literal("acknowledge"), id }),
]);
export function profileDraft(
  brand: Entity<Brand>,
  p: Provider,
  handle: string,
  link: string,
) {
  const limit = definitions[p].bio;
  const bio = [brand.data.positioning, brand.data.cta]
    .filter(Boolean)
    .join(" · ")
    .slice(0, limit);
  return {
    status: "draft",
    platform: p,
    source_brand_id: brand.id,
    source_brand_revision: brand.version,
    name: brand.data.name,
    handle,
    bio,
    link,
    category: "Applied AI",
    language: brand.data.language,
    avatar: "MISSING_HUMAN_ASSET",
    banner: p === "youtube" || p === "x" ? "MISSING_HUMAN_ASSET" : null,
    approved_by: null,
    approved_at: null,
  };
}
export function profileDrift(
  desired: Record<string, unknown>,
  actual?: Record<string, unknown>,
) {
  if (!actual) return { status: "UNKNOWN", fields: [] };
  const unavailableBio =
    (actual.raw as Record<string, unknown> | undefined)
      ?.profile_bio_available === false;
  const fields = (
    unavailableBio ? ["name", "handle"] : ["name", "handle", "bio"]
  ).filter(
    (k) => String(desired[k] ?? "").trim() !== String(actual[k] ?? "").trim(),
  );
  return {
    status: fields.length ? "DRIFT" : unavailableBio ? "UNKNOWN" : "MATCH",
    fields,
  };
}
export async function activationState(rpc: Rpc, demo: boolean) {
  const { state: s, stories, production } = await controlSnapshot(rpc, demo);
  const launch = s.entities.find((e) => e.kind === "launch_plan");
  const launch_slots = (
    (launch?.data.slots ?? []) as { title: string; content_id: string | null }[]
  ).map((slot) => {
    const c = s.entities.find(
      (e) => e.id === slot.content_id && e.kind === "content",
    ) as Entity<Content> | undefined;
    return {
      ...slot,
      readiness: c
        ? readiness(c, s, stories, production)
        : { ready: false, issues: ["Content selection required"] },
    };
  });
  const distribution = (
    (await rpc("read_provider_outbox", { p_demo: demo })) as {
      id: string;
      package_id: string;
      provider: string;
      status: string;
      due_at: string;
      remote: { status?: string; url?: string };
      error?: string;
    }[]
  ).map((r) => ({
    id: r.id,
    package_id: r.package_id,
    provider: r.provider,
    status: r.status,
    remote_status: r.remote?.status ?? null,
    due_at: r.due_at,
    url: r.remote?.url ?? null,
    error: r.error ?? null,
  }));
  return {
    distribution,
    launch_slots,
    ...s,
    providers: platforms.map((p) => {
      let ready = false;
      try {
        if (p === "beehiiv") ready = true;
        else {
          appConfig(p);
          ready = true;
        }
      } catch {}
      const a = s.entities.find(
          (e) => e.kind === "account" && e.data.platform === p,
        ),
        profile = s.entities.find(
          (e) => e.kind === "profile" && e.data.platform === p,
        );
      return {
        platform: p,
        signup: definitions[p].signup,
        account: a ?? null,
        profile: profile ?? null,
        free_connector: ["instagram", "tiktok", "x"].includes(p),
        transport: a?.data.delivery_transport ?? "native",
        engineering:
          a?.data.status === "connected"
            ? "CONNECTED"
            : ready || ["instagram", "tiktok", "x"].includes(p)
              ? "READY_FOR_AUTH"
              : "IMPLEMENTED_UNVERIFIED",
        app_configured: ready,
        drift: profileDrift(
          profile?.data ?? {},
          a?.data.profile as Record<string, unknown> | undefined,
        ),
        capabilities: a?.data.capabilities ?? [],
        blocker:
          p === "x" &&
          (launch?.data.account_blockers as Record<string, string> | undefined)
            ?.x === "BLOCKED_ACCOUNT_RECOVERY"
            ? "BLOCKED_ACCOUNT_RECOVERY"
            : a?.data.delivery_transport === "buffer"
              ? (a.data.reason ?? "Buffer connected")
              : p === "x"
                ? "Paid API access; no spend authorized"
                : p === "beehiiv"
                  ? (a?.data.reason ?? "API key and eligible posts API access")
                  : !ready
                    ? "Developer application/client credentials missing"
                    : (a?.data.reason ?? "Create account and connect"),
      };
    }),
  };
}
export async function activationAction(
  rpc: Rpc,
  raw: unknown,
  actor: string,
  demo: boolean,
) {
  const c = activationCommand.parse(raw);
  if (c.action === "buffer_delivery") {
    const { enqueueOutbox, processOutbox } = await import("./outbox");
    const id = await enqueueOutbox(
      rpc,
      c.package_id,
      new Date().toISOString(),
      demo,
      {
        mode: c.mode,
        ...(c.scheduled_at ? { scheduled_at: c.scheduled_at } : {}),
      },
    );
    const { existingOutbox, manageDistribution } = await import("./management");
    const existing = await existingOutbox(rpc, id, demo);
    if (existing?.status === "draft" && c.mode !== "draft")
      await manageDistribution(rpc, id, demo, actor, "release", {
        mode: c.mode,
        ...(c.scheduled_at ? { scheduled_at: c.scheduled_at } : {}),
      });
    else if (
      existing?.payload.delivery &&
      JSON.stringify(existing.payload.delivery) !==
        JSON.stringify({
          mode: c.mode,
          ...(c.scheduled_at ? { scheduled_at: c.scheduled_at } : {}),
        })
    )
      throw Error(
        "This immutable publication request already has a different delivery authorization",
      );
    await processOutbox(rpc, demo);
    const result = await existingOutbox(rpc, id, demo);
    return {
      id,
      status: result?.status ?? "unknown",
      remote_status: result?.remote.status ?? null,
      result_url: result?.remote.url ?? null,
    };
  }
  if (c.action === "job_resolve") {
    await rpc("resolve_control_job", {
      p_id: c.id,
      p_demo: demo,
      p_actor: actor,
    });
    return {};
  }
  if (c.action === "carousel_drive") {
    const { exportCarouselDrive } = await import("./carousel");
    return exportCarouselDrive(rpc, c.id, demo);
  }
  if (c.action === "outbox_recover") {
    if (c.operation === "cancel") {
      const { manageDistribution } = await import("./management");
      await manageDistribution(rpc, c.id, demo, actor, "cancel");
      return {};
    }
    await rpc("recover_provider_outbox", {
      p_id: c.id,
      p_action: c.operation,
      p_actor: actor,
      p_demo: demo,
    });
    return {};
  }
  if (c.action === "auth_start")
    return startProviderAuth(rpc, c.provider, actor, c.id);
  if (c.action === "select") {
    await selectProviderAccount(rpc, c.id, c.external_id, actor);
    return {};
  }
  if (c.action === "buffer_key") {
    if (demo) throw Error("Connect real accounts in the live workspace");
    return installBuffer(rpc, c.key, actor);
  }
  if (c.action === "beehiiv_key") {
    await installBeehiiv(rpc, c.id, c.key, actor);
    return {};
  }
  if (c.action === "disconnect") {
    await disconnectProvider(rpc, c.id, actor);
    return {};
  }
  if (c.action === "created")
    return controlAction(
      rpc,
      { action: "account_create", platform: c.provider, handle: c.handle },
      actor,
      demo,
    );
  const s = await readControl(rpc, demo),
    changes: Entity[] = [];
  const add = (
    kind: Entity["kind"],
    data: Record<string, unknown>,
    prev?: Entity,
  ) => {
    const e: Entity = {
      id: prev?.id ?? randomUUID(),
      kind,
      version: (prev?.version ?? 0) + 1,
      story_id: null,
      draft_id: null,
      parent_id: prev?.parent_id ?? null,
      is_demo: demo,
      data,
    };
    changes.push(e);
    return e;
  };
  const find = (value: string, kind: Entity["kind"]) => {
    const e = s.entities.find((e) => e.id === value && e.kind === kind);
    if (!e) throw Error("Record missing");
    return e;
  };
  if (c.action === "distribution_authorize") {
    const a = find(c.id, "account");
    if (
      c.enabled &&
      (a.data.status !== "connected" ||
        !(a.data.capabilities as string[]).includes("publish") ||
        !a.data.external_id ||
        !Number.isFinite(Date.parse(String(a.data.verified_at))))
    )
      throw Error("Verify a connected publish-capable account first");
    add(
      "account",
      {
        ...a.data,
        writes_authorized: c.enabled,
        writes_authorized_by: actor,
        writes_authorized_at: new Date().toISOString(),
      },
      a,
    );
  }
  if (c.action === "handle") {
    add(
      "handle",
      {
        name: c.name,
        fallbacks: c.fallbacks,
        status: "approved_identity",
        availability_reported: c.available,
        approved_by: actor,
        approved_at: new Date().toISOString(),
      },
      s.entities.find((e) => e.kind === "handle"),
    );
    for (const profile of s.entities.filter(
      (e) => e.kind === "profile" && e.data.status === "approved",
    ))
      add(
        "profile",
        {
          ...profile.data,
          status: "draft",
          approved_by: null,
          approved_at: null,
          invalidation_reason: "Handle revision changed; regenerate profile",
        },
        profile,
      );
  }
  if (c.action === "checklist") {
    const a = find(c.id, "account");
    add(
      "account",
      {
        ...a.data,
        two_factor: c.two_factor,
        recovery_stored: c.recovery_stored,
        email_strategy: c.email_strategy,
      },
      a,
    );
  }
  if (c.action === "profile_generate") {
    const b = s.entities.find(
      (e) => e.kind === "brand" && e.data.status === "active",
    ) as unknown as Entity<Brand>;
    if (!b) throw Error("Approve an active brand revision first");
    const identity = s.entities.find((e) => e.kind === "handle");
    if (!identity?.data.approved_at)
      throw Error("Confirm the intended handle identity first");
    const handle = identity.data.name as string | undefined;
    if (!handle) throw Error("Record the intended handle first");
    add("profile", {
      ...profileDraft(
        b,
        c.provider,
        handle,
        `${process.env.CONTENT_OS_ORIGIN ?? "https://example.invalid"}/about`,
      ),
      source_handle_id: identity.id,
      source_handle_revision: identity.version,
    });
  }
  if (c.action === "profile_save") {
    const e = find(c.id, "profile");
    if (e.data.status === "approved")
      throw Error(
        "Generate a new profile revision before editing approved copy",
      );
    if (c.bio.length > definitions[e.data.platform as Provider].bio)
      throw Error("Provider bio character limit exceeded");
    validatePublicLink(c.link);
    add(
      "profile",
      {
        ...e.data,
        name: c.name,
        handle: c.handle,
        bio: c.bio,
        link: c.link,
        category: c.category,
      },
      e,
    );
  }
  if (c.action === "profile_approve") {
    const e = find(c.id, "profile"),
      b = s.entities.find(
        (v) =>
          v.id === e.data.source_brand_id &&
          v.version === e.data.source_brand_revision &&
          v.data.status === "active",
      );
    if (!b) throw Error("Brand revision changed; regenerate profile");
    const identity = s.entities.find((v) => v.kind === "handle");
    if (
      !identity?.data.approved_at ||
      identity.id !== e.data.source_handle_id ||
      identity.version !== e.data.source_handle_revision
    )
      throw Error("Handle revision changed; regenerate profile");
    validatePublicLink(String(e.data.link));
    add(
      "profile",
      {
        ...e.data,
        status: "approved",
        approved_by: actor,
        approved_at: new Date().toISOString(),
      },
      e,
    );
  }
  if (c.action === "acknowledge") {
    const n = find(c.id, "notification");
    add(
      "notification",
      { ...n.data, read_at: new Date().toISOString(), read_by: actor },
      n,
    );
  }
  if (c.action === "launch_initialize") {
    if (!s.entities.some((e) => e.kind === "handle"))
      add("handle", {
        name: "danielbuildsai",
        fallbacks: ["danielaiwork", "danielbrainos"],
        status: "draft_candidates",
        availability_reported: null,
        approved_by: null,
        approved_at: null,
      });
    if (
      !s.entities.some(
        (e) => e.kind === "launch_plan" && e.data.name === "Brand Launch V1",
      )
    ) {
      const concept =
        "I built an AI newsroom for my personal brand, but I deliberately refused to let AI become the creator.";
      const brand = s.entities.find(
        (e) => e.kind === "brand" && e.data.status === "active",
      );
      const titles = [
        "INTRO / MANIFESTO",
        "BUILD WITH ME — BrainOS",
        "AI RIGHT NOW",
        "I TESTED IT",
        "AI AT WORK",
        "MY TAKE",
        "EDITORIAL CAROUSEL",
        "NEWSLETTER ISSUE 0",
      ];
      const slots = titles.map((title, n) => {
        const content = add("content", {
          title,
          pillar: title,
          purpose:
            n === 0
              ? concept
              : "Launch slot; Daniel must select the evidence and angle",
          platform: n === 7 ? "beehiiv" : n === 6 ? "instagram" : "youtube",
          format: n === 7 ? "newsletter" : n === 6 ? "carousel" : "video",
          language: brand?.data.language ?? "es",
          angle_id: null,
          take_id: null,
          owner: actor,
          content_state: "planned",
          production_state: n < 6 ? "recording_needed" : "not_required",
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
          status: "draft",
          platform_shells: platforms.map((platform) => ({
            platform,
            status: "SCRIPT_REVISION_REQUIRED",
            package_id: null,
          })),
          ...(n === 0
            ? {
                build_references: [
                  {
                    kind: "implementation",
                    path: "src/control/service.ts",
                    claim: "Human approval gates",
                  },
                  {
                    kind: "implementation",
                    path: "src/production/model.ts",
                    claim: "Exact production revisions",
                  },
                  {
                    kind: "implementation",
                    path: "src/integrations/personal-drive.ts",
                    claim: "Personal-only Drive scope",
                  },
                ],
                visual_beats: [
                  "Morning Brief",
                  "Evidence and claims",
                  "Suggested angle vs human approval",
                  "Script revision",
                  "Production Studio",
                  "Platform package",
                ],
                recording_requirements: [
                  "Daniel on camera",
                  "Screen recording from /recording-demo (fictional fixtures)",
                  "Daniel selects and verifies the demonstrated behavior",
                ],
                b_roll: [
                  "Hands at keyboard",
                  "BrainOS screen capture",
                  "Local worker status without terminal credentials",
                ],
                production_checklist: [
                  "Choose exact angle",
                  "Approve script revision",
                  "Record",
                  "Transcribe",
                  "Review edit plan",
                  "Clear assets",
                  "Render",
                  "Approve exact final output",
                ],
              }
            : {}),
        });
        return {
          title,
          content_id: content.id,
          status: "HUMAN_SELECTION_REQUIRED",
        };
      });
      const campaign = add("campaign", {
        name: "Brand Launch V1",
        content_ids: slots.map((s) => s.content_id),
        created_by: actor,
        created_at: new Date().toISOString(),
      });
      add("launch_plan", {
        name: "Brand Launch V1",
        campaign_id: campaign.id,
        slots,
        intro: {
          concept,
          status: "draft_structure",
          final_script: null,
          approved: false,
        },
        asset_requirements: [
          "avatar",
          "youtube_banner",
          "x_header",
          "newsletter_logo",
          "social_covers",
        ].map((slot) => ({
          slot,
          status: "MISSING_HUMAN_ASSET",
          asset_id: null,
          rights: "unknown",
          approved_at: null,
        })),
        capture_map: [
          { screen: "Morning Brief", href: "/recording-demo#brief" },
          { screen: "Evidence/claims", href: "/recording-demo#evidence" },
          {
            screen: "Angle suggestion vs approval",
            href: "/recording-demo#angle",
          },
          { screen: "Exact script", href: "/recording-demo#script" },
          {
            screen: "Drive / Production / worker",
            href: "/recording-demo#production",
          },
          {
            screen: "Package / analytics",
            href: "/recording-demo#distribution",
          },
        ],
      });
    }
  }
  await rpc("commit_control", {
    p_epoch: s.epoch,
    p_entities: changes,
    p_jobs: [],
    p_public: [],
    p_actor: actor,
  });
  return {};
}
