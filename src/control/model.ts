import { createHash } from "node:crypto";
import type { Story, Draft } from "../domain/types";
import type { StudioState } from "../production/types";
export const platforms = [
  "instagram",
  "tiktok",
  "x",
  "youtube",
  "beehiiv",
] as const;
export type Provider = (typeof platforms)[number];
export type Kind =
  | "brand"
  | "idea"
  | "content"
  | "take"
  | "account"
  | "package"
  | "campaign"
  | "newsletter"
  | "experiment"
  | "review"
  | "graphic"
  | "quality"
  | "decision"
  | "question"
  | "link"
  | "notification"
  | "publication"
  | "profile"
  | "handle"
  | "outbox"
  | "opportunity"
  | "launch_plan";
export interface Entity<T = Record<string, unknown>> {
  id: string;
  kind: Kind;
  version: number;
  story_id: string | null;
  draft_id: string | null;
  parent_id: string | null;
  is_demo: boolean;
  data: T;
  updated_at?: string;
}
export interface Job {
  id: string;
  kind: "distribution" | "analytics" | "graphic" | "export";
  entity_id: string;
  entity_version: number;
  is_demo: boolean;
  idempotency_key: string;
  status: string;
  due_at: string;
  input: Record<string, unknown>;
  result?: Record<string, unknown>;
  error: string | null;
  retryable: boolean;
  attempts?: number;
  lease_token?: string;
}
export interface Presence {
  id: string;
  protocol: number;
  version: string;
  capabilities: string[];
  active_job: string | null;
  last_seen: string;
}
export interface ControlState {
  epoch: number;
  entities: Entity[];
  jobs: Job[];
  events: { id: number; kind: string; actor: string; created_at: string }[];
  workers: Presence[];
}
export interface Content {
  status?: string;
  title: string;
  pillar: string;
  purpose: string;
  platform: Provider;
  format: "video" | "post" | "thread" | "carousel" | "newsletter";
  language: string;
  angle_id: string | null;
  take_id: string | null;
  owner: string;
  content_state: string;
  production_state: string;
  distribution_state: string;
  analytics_state: string;
  draft_revision: number | null;
  production_id: string | null;
  fresh_until: string | null;
  evergreen: boolean;
  claims_reviewed_at: string | null;
  revalidation_required: boolean;
  final_approval: {
    actor: string;
    at: string;
    fingerprint: string;
    package_id: string;
    package_version: number;
  } | null;
  quality_issues: QualityIssue[];
}
export interface Brand {
  status: "draft" | "active" | "superseded";
  name: string;
  language: string;
  secondary_language: string;
  positioning: string;
  audience: string;
  pillars: string[];
  tone: string[];
  visual: string[];
  rules: VoiceRule[];
  cta: string;
  approved_by?: string;
  approved_at?: string;
}
export interface Account {
  platform: Provider;
  delivery_transport?: "buffer" | "native";
  api_version?: string;
  implementation?: string;
  status:
    | "not_created"
    | "created_not_connected"
    | "auth_required"
    | "connected"
    | "degraded"
    | "revoked";
  handle: string;
  external_id: string | null;
  capabilities: string[];
  verified_at: string | null;
  reason: string | null;
}
export interface Package {
  attribution?: {
    text: string;
    links: string[];
    publishers: string[];
    source_card_refs: string[];
    version: string;
  };
  privacy?: string;
  status: "draft" | "approved" | "invalidated";
  content_id: string;
  content_version: number;
  draft_id: string;
  draft_revision: number;
  brand_id: string;
  brand_version: number;
  platform: Provider;
  caption: string;
  title: string;
  cta: string;
  thread: string[];
  source_links: string[];
  media_id: string | null;
  duration: number | null;
  aspect: "9:16" | "original" | null;
  language: string;
  subtitles: string | null;
  graphic_ids: string[];
  fingerprint: string;
  approved_by?: string;
  approved_at?: string;
}
export interface VoiceRule {
  id: string;
  pattern: string;
  severity: "high" | "medium" | "low";
  remediation: string;
}
export interface QualityIssue {
  rule: string;
  severity: string;
  excerpt: string;
  start: number;
  end: number;
  remediation: string;
  review_status: "open" | "acknowledged";
}
export const defaultRules: VoiceRule[] = [
  {
    id: "contrast",
    pattern: "No es .{1,100},? (?:es|sino) .{1,100}",
    severity: "medium",
    remediation: "State the concrete point directly.",
  },
  {
    id: "generic_question",
    pattern: "¿Por qué importa\\?|¿Qué (?:opinas|probarías)|¿Estás listo",
    severity: "medium",
    remediation: "Offer a useful, specific next action.",
  },
  {
    id: "ai_phrase",
    pattern:
      "Hay un matiz importante|en el mundo de hoy|sin lugar a dudas|es importante destacar",
    severity: "medium",
    remediation: "Replace the canned transition with the specific evidence.",
  },
  {
    id: "hype",
    pattern:
      "revolucionari[oa]|game.?changer|cambiará todo|el futuro ya está aquí",
    severity: "medium",
    remediation: "Describe a bounded capability and its limitation.",
  },
  {
    id: "false_experience",
    pattern:
      "yo probé|he probado|mi experiencia demuestra|comprobé personalmente",
    severity: "high",
    remediation:
      "Attach evidence of Daniel doing this test before asserting experience.",
  },
  {
    id: "fake_conviction",
    pattern: "estoy convencido|no tengo ninguna duda|todos sabemos",
    severity: "high",
    remediation: "Confirm this exact position with Daniel.",
  },
  {
    id: "caveats",
    pattern:
      "(?:sin embargo|no obstante|aun así|pero hay).{0,120}(?:sin embargo|no obstante|aun así|pero hay)",
    severity: "low",
    remediation: "Keep only the caveat that changes the audience's decision.",
  },
  {
    id: "conclusion",
    pattern: "en conclusión|en resumen|para concluir",
    severity: "low",
    remediation: "End with the specific result or next step.",
  },
];
export function quality(
  text: string,
  rules: VoiceRule[] = defaultRules,
): QualityIssue[] {
  return rules.flatMap((r) => {
    const out: QualityIssue[] = [];
    const re = new RegExp(r.pattern, "giu");
    let match;
    while ((match = re.exec(text)) && out.length < 30) {
      out.push({
        rule: r.id,
        severity: r.severity,
        excerpt: match[0],
        start: match.index,
        end: match.index + match[0].length,
        remediation: r.remediation,
        review_status: "open",
      });
      if (!match[0].length) re.lastIndex++;
    }
    return out;
  });
}
export const transitions: Record<string, Record<string, string[]>> = {
  content: {
    planned: ["drafting", "rejected", "archived"],
    drafting: ["draft_ready", "rejected"],
    draft_ready: ["review", "drafting", "rejected"],
    review: ["approved", "drafting", "rejected"],
    approved: ["drafting", "archived"],
    rejected: ["planned", "archived"],
    archived: [],
  },
  distribution: {
    not_ready: ["ready"],
    ready: ["scheduled", "not_ready"],
    scheduled: ["publishing", "not_ready"],
    publishing: ["published", "failed"],
    failed: ["ready"],
    published: [],
  },
  analytics: {
    pending: ["scheduled"],
    scheduled: ["collecting"],
    collecting: ["measured", "scheduled"],
    measured: ["reviewed"],
    reviewed: [],
  },
  idea: {
    captured: ["qualified", "archived"],
    qualified: ["selected", "archived"],
    selected: ["content_planned", "archived"],
    content_planned: ["archived"],
    archived: [],
  },
  newsletter: {
    planning: ["drafting"],
    drafting: ["review"],
    review: ["approved", "drafting"],
    approved: ["ready_for_provider"],
    ready_for_provider: ["scheduled"],
    scheduled: ["published"],
    published: ["measured"],
    measured: [],
  },
};
export function transition(machine: string, from: string, to: string) {
  if (!transitions[machine]?.[from]?.includes(to))
    throw Error(`Invalid ${machine} transition: ${from} → ${to}`);
  return to;
}
export function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function workerAvailable(state: ControlState, now = Date.now()) {
  return state.workers.some(
    (w) =>
      w.protocol === 1 &&
      now - Date.parse(w.last_seen) < 660000 &&
      w.capabilities.includes("render"),
  );
}
export function exactDraft(content: Entity<Content>, stories: Story[]) {
  const s = stories.find((s) => s.id === content.story_id),
    d = s?.drafts.find((d) => d.id === content.draft_id);
  if (
    !s ||
    !d ||
    d.revision !== content.data.draft_revision ||
    d.status !== "approved" ||
    !d.approved_by ||
    !d.approved_at ||
    !s.research_confirmed ||
    s.active_draft_id !== d.id
  )
    throw Error("Current exact approved script revision required");
  if (
    !s.angles.some(
      (a) => a.id === d.angle_id && a.approval_state === "approved",
    )
  )
    throw Error("Approved angle required");
  if (
    d.asset_ids.some(
      (id) =>
        !s.assets.some(
          (a) =>
            a.id === id &&
            a.publishable &&
            a.rights_status === "cleared" &&
            a.cleared_by &&
            a.usage_basis,
        ),
    )
  )
    throw Error("Required asset rights unresolved");
  return { story: s, draft: d };
}
export function fresh(content: Content, now = Date.now()) {
  return (
    content.evergreen ||
    (!!content.fresh_until &&
      Date.parse(content.fresh_until) > now &&
      !content.revalidation_required)
  );
}
export function approvedTake(content: Content, state: ControlState) {
  if (!content.take_id) return false;
  const take = state.entities.find(
    (e) => e.id === content.take_id && e.kind === "take",
  );
  return take?.data.status === "approved" && !!take.data.approved_by;
}
export function packageFingerprint(
  content: Entity<Content>,
  draft: Draft,
  studio: StudioState,
  graphics: Entity[],
) {
  const production = studio.packages.find(
    (p) => p.id === content.data.production_id,
  );
  return hash({
    content_id: content.id,
    title: content.data.title,
    take_id: content.data.take_id,
    platform: content.data.platform,
    draft_id: draft.id,
    revision: draft.revision,
    approved_at: draft.approved_at,
    production: production
      ? {
          version: production.version,
          valid: production.valid,
          approval: production.data.approval,
          output: production.data.output?.sha256,
        }
      : null,
    graphics: graphics
      .map((g) => ({
        id: g.id,
        version: g.version,
        sha256: g.data.sha256,
        rights: g.data.rights,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}
export function productionIssues(
  content: Entity<Content>,
  studio: StudioState,
  state: ControlState,
) {
  if (content.data.format !== "video") return [];
  const p = studio.packages.find((p) => p.id === content.data.production_id);
  if (!p) return ["Recording package required"];
  if (!p.valid) return ["Production revision invalidated"];
  if (
    !p.data.approval ||
    p.data.state !== "approved" ||
    p.data.approval.production_version !== p.version ||
    p.data.approval.output_sha256 !== p.data.output?.sha256
  )
    return [
      workerAvailable(state)
        ? "Exact final production approval required"
        : "BLOCKED_BY_WORKER · final production incomplete",
    ];
  return [];
}
export function baseline(values: number[], current: number) {
  if (values.length < 5)
    return {
      sample_size: values.length,
      warning: "Insufficient history (minimum 5); no significance claim",
      relative: null,
      delta: null,
    };
  const sorted = [...values].sort((a, b) => a - b),
    median = sorted[Math.floor(sorted.length / 2)];
  return {
    sample_size: values.length,
    warning:
      values.length < 20 ? "Small sample; descriptive comparison only" : null,
    median,
    relative: median ? current / median : null,
    delta: current - median,
  };
}
export function risk(text: string) {
  const rules: Record<string, RegExp> = {
    pricing: /precio|price|cost|costo/i,
    benchmarks: /benchmark|%|más rápido/i,
    security: /security|vulnerab|seguridad/i,
    legal: /legal|regulat|ley/i,
    financial: /invers|financial|financ/i,
    health: /health|salud|médic/i,
    personnel: /CEO|despid|adquisi|anunci/i,
  };
  return Object.keys(rules).filter((category) => rules[category].test(text));
}
