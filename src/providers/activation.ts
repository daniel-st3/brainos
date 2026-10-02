import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Rpc } from "../ingestion/store";
import {
  platforms,
  type Brand,
  type Entity,
  type Provider,
} from "../control/model";
import { readControl, controlAction } from "../control/service";
import { definitions, appConfig } from "./definitions";
import {
  startProviderAuth,
  selectProviderAccount,
  installBeehiiv,
  disconnectProvider,
} from "./auth";
const id = z.uuid(),
  short = z.string().trim().min(1).max(200);
export const activationCommand = z.discriminatedUnion("action", [
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
    action: z.literal("outbox_recover"),
    id,
    operation: z.enum(["retry", "reconcile", "cancel", "resolved"]),
  }),
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
  const fields = ["name", "handle", "bio"].filter(
    (k) => String(desired[k] ?? "").trim() !== String(actual[k] ?? "").trim(),
  );
  return { status: fields.length ? "DRIFT" : "MATCH", fields };
}
export async function activationState(rpc: Rpc, demo: boolean) {
  const s = await readControl(rpc, demo);
  return {
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
        engineering: ready ? "READY_FOR_AUTH" : "IMPLEMENTED_UNVERIFIED",
        app_configured: ready,
        drift: profileDrift(
          profile?.data ?? {},
          a?.data.profile as Record<string, unknown> | undefined,
        ),
        capabilities: a?.data.capabilities ?? [],
        blocker:
          p === "x"
            ? "Paid API access; no spend authorized"
            : p === "beehiiv"
              ? "API key and eligible posts API access"
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
  if (c.action === "outbox_recover") {
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
  if (c.action === "handle")
    add(
      "handle",
      {
        name: c.name,
        fallbacks: c.fallbacks,
        availability_reported: c.available,
        approved_by: actor,
        approved_at: new Date().toISOString(),
      },
      s.entities.find((e) => e.kind === "handle"),
    );
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
    const handle = s.entities.find((e) => e.kind === "handle")?.data.name as
      string | undefined;
    if (!handle) throw Error("Record the intended handle first");
    add(
      "profile",
      profileDraft(
        b,
        c.provider,
        handle,
        `${process.env.CONTENT_OS_ORIGIN ?? "https://example.invalid"}/about`,
      ),
    );
  }
  if (c.action === "profile_save") {
    const e = find(c.id, "profile");
    if (e.data.status === "approved")
      throw Error(
        "Generate a new profile revision before editing approved copy",
      );
    if (c.bio.length > definitions[e.data.platform as Provider].bio)
      throw Error("Provider bio character limit exceeded");
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
    if (
      !s.entities.some(
        (e) => e.kind === "launch_plan" && e.data.name === "Brand Launch V1",
      )
    )
      add("launch_plan", {
        name: "Brand Launch V1",
        slots: [
          "INTRO / MANIFESTO",
          "BUILD WITH ME — BrainOS",
          "AI RIGHT NOW",
          "I TESTED IT",
          "AI AT WORK",
          "MY TAKE",
          "EDITORIAL CAROUSEL",
          "NEWSLETTER ISSUE 0",
        ].map((title) => ({
          title,
          content_id: null,
          status: "CONTENT_SELECTION_REQUIRED",
        })),
        intro: {
          concept:
            "I built an AI newsroom for my personal brand, but I deliberately refused to let AI become the creator.",
          status: "draft_structure",
          final_script: null,
          approved: false,
          evidence: [
            "Human editorial gates",
            "Exact approved revisions",
            "Rights controls",
            "Personal Drive/local worker",
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
            "Screen recording in labelled demo mode",
            "Mask private notes and identifiers",
          ],
          checklist: [
            "Daniel selects angle",
            "Daniel approves exact script",
            "Record",
            "Clear assets",
            "Review exact final output",
          ],
        },
      });
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
