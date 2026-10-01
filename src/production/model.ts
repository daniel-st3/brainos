import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Story } from "../domain/types";
import { approvedProductionPacket } from "../operations/production";
import type {
  ProductionPackage,
  ProductionAsset,
  Transcript,
  EditPlan,
  RecordingMedia,
  RenderOptions,
} from "./types";
export const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const mediaSchema = z.object({
  id: z.uuid(),
  story_id: z.uuid(),
  draft_id: z.uuid(),
  provider: z.enum(["supabase", "drive", "local"]),
  file_id: z.string().min(1).max(1000),
  filename: z.string().min(1).max(240),
  mime: z.enum([
    "video/mp4",
    "video/quicktime",
    "video/webm",
    "audio/wav",
    "audio/mpeg",
    "audio/mp4",
    "audio/x-wav",
  ]),
  bytes: z.number().int().positive(),
  duration: z.number().positive().max(14400).nullable(),
  captured_at: z.iso.datetime().nullable(),
  uploaded_at: z.iso.datetime(),
  owned_confirmed: z.boolean(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  status: z.literal("received"),
});
export const transcriptSchema = z.object({
  language: z.enum(["es", "en"]),
  provider: z.string().min(1).max(100),
  media_id: z.uuid(),
  media_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  duration: z.number().positive().max(14400),
  silences: z
    .array(
      z.object({ start: z.number().nonnegative(), end: z.number().positive() }),
    )
    .max(12000)
    .optional(),
  segments: z
    .array(
      z.object({
        start: z.number().nonnegative(),
        end: z.number().positive(),
        text: z.string().trim().min(1).max(2000),
        confidence: z.number().min(0).max(1).optional(),
      }),
    )
    .min(1)
    .max(12000),
});
export const renderOptionsSchema = z.object({
  layout: z.enum(["vertical", "original"]),
  normalize: z.boolean(),
  burn_subtitles: z.boolean(),
  remove_pauses: z.boolean(),
});
export function createPackage(
  story: Story,
  draftId: string,
  actor: string,
): ProductionPackage {
  const packet = approvedProductionPacket(story, draftId),
    draft = story.drafts.find((d) => d.id === draftId)!;
  const assets: ProductionAsset[] = packet.assets.map((a) => ({
    id: a.id,
    kind: "broll",
    title: a.title,
    required: true,
    rights: a.rights_status,
    publishable: a.publishable,
    basis: a.usage_basis,
    attribution: a.attribution,
    source_url: a.source_url,
    reference: a.storage_url ?? a.source_url,
    cleared_by: a.cleared_by ?? undefined,
  }));
  const suggestions: [ProductionAsset["kind"], string][] = [
    ["screenshot", "Captura propia del producto; ocultar datos privados"],
    ["official", "Imagen oficial con condiciones de uso verificables"],
    ["chart", "Diagrama de la explicación, sin cifras no verificadas"],
    ["source_card", "Tarjeta de fuente con enlace y atribución"],
    ["broll", "Daniel usando el producto o mostrando el flujo"],
  ];
  suggestions.forEach(([kind, title]) =>
    assets.push({
      id: randomUUID(),
      kind,
      title,
      required: false,
      rights: "unknown",
      publishable: false,
      basis: "",
      attribution: "",
      source_url: story.sources[0]?.canonical_url ?? "",
      reference: "",
    }),
  );
  return {
    id: randomUUID(),
    story_id: story.id,
    draft_id: draftId,
    version: 0,
    valid: true,
    invalid_reason: null,
    data: {
      state: "recording_needed",
      packet,
      title: story.title,
      angle_id: draft.angle_id,
      created_by: actor,
      created_at: new Date().toISOString(),
      media: [],
      selected_media_id: null,
      assets,
      transcript: null,
      edit_plan: null,
      output: null,
      approval: null,
    },
  };
}
export function assertCurrent(p: ProductionPackage, story: Story) {
  if (!p.valid) throw Error(p.invalid_reason ?? "Production invalidated");
  const packet = approvedProductionPacket(story, p.draft_id);
  if (
    packet.revision !== p.data.packet.revision ||
    Date.parse(packet.approved_at) !== Date.parse(p.data.packet.approved_at) ||
    digest(packet.teleprompter) !== digest(p.data.packet.teleprompter)
  )
    throw Error("Script revision mismatch; create a new recording package.");
}
export function attachMedia(p: ProductionPackage, raw: unknown) {
  const m = mediaSchema.parse(raw);
  if (m.story_id !== p.story_id || m.draft_id !== p.draft_id)
    throw Error("Media must reference the exact story and draft revision.");
  if (!m.owned_confirmed)
    throw Error(
      "Confirm this is Daniel-owned recording. Third-party media needs separate asset clearance.",
    );
  const next = structuredClone(p);
  const prior = next.data.media.find(
    (x) => x.provider === m.provider && x.file_id === m.file_id,
  );
  if (prior) return next;
  next.data.media.push(m);
  next.data.selected_media_id = m.id;
  next.data.state = "recording_received";
  next.data.transcript = null;
  next.data.edit_plan = null;
  next.data.output = null;
  next.data.approval = null;
  return next;
}
export function acceptTranscript(p: ProductionPackage, raw: unknown) {
  const input = transcriptSchema.parse(raw),
    media = p.data.media.find((m) => m.id === input.media_id);
  if (!media || p.data.selected_media_id !== input.media_id)
    throw Error("Transcript source media mismatch");
  if (media.sha256 && media.sha256 !== input.media_sha256)
    throw Error("Original media checksum changed");
  let end = 0;
  for (const s of input.segments) {
    if (s.start < end || s.end <= s.start || s.end > input.duration + 0.1)
      throw Error(
        "Transcript segments must be ordered, nonoverlapping and within media duration",
      );
    end = s.end;
  }
  let silenceEnd = 0;
  for (const s of input.silences ?? []) {
    if (
      s.start < silenceEnd ||
      s.end <= s.start ||
      s.end > input.duration + 0.1
    )
      throw Error("Invalid or unordered acoustic silence interval");
    silenceEnd = s.end;
  }
  const next = structuredClone(p);
  next.data.transcript = {
    ...input,
    text: input.segments.map((s) => s.text).join(" "),
    reviewed: false,
  };
  next.data.media.find((m) => m.id === input.media_id)!.sha256 =
    input.media_sha256;
  next.data.media.find((m) => m.id === input.media_id)!.duration =
    input.duration;
  next.data.media.find((m) => m.id === input.media_id)!.status = "transcribed";
  next.data.state = "transcribed";
  next.data.edit_plan = null;
  next.data.output = null;
  next.data.approval = null;
  return next;
}
export function roughEdit(p: ProductionPackage): EditPlan {
  const t = p.data.transcript;
  if (!t) throw Error("Transcript required");
  const markers: EditPlan["markers"] = [],
    seen = new Map<string, number>();
  let last = 0;
  t.segments.forEach((s, i) => {
    if (!t.silences && s.start - last >= 0.8)
      markers.push({
        start: last,
        end: s.start,
        kind: "pause",
        reason: "Interval without transcript; inspect audio before cutting",
        suggested: true,
      });
    const normalized = s.text
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    if (normalized.length > 15 && seen.has(normalized)) {
      const prev = t.segments[seen.get(normalized)!];
      markers.push({
        start: prev.start,
        end: prev.end,
        kind: "repeat",
        reason: `Repeated wording; later take at ${s.start.toFixed(2)}s is a candidate, not automatically better`,
        suggested: true,
      });
    }
    seen.set(normalized, i);
    if (
      /\b(eh|em|uh|um|perd[oó]n|otra vez|me equivoqu[eé]|restart)\b/i.test(
        s.text,
      )
    )
      markers.push({
        start: s.start,
        end: s.end,
        kind: "restart",
        reason: "Possible filler or restart; review in context",
        suggested: true,
      });
    if (i === 0)
      markers.push({
        start: s.start,
        end: s.end,
        kind: "emphasis",
        reason: "Opening phrase / caption emphasis candidate",
        suggested: true,
      });
    last = s.end;
  });
  if (!t.silences && t.duration - last >= 0.8)
    markers.push({
      start: last,
      end: t.duration,
      kind: "pause",
      reason: "Trailing region without transcript; inspect before cutting",
      suggested: true,
    });
  t.silences?.forEach((s) =>
    markers.push({
      start: s.start,
      end: s.end,
      kind: "pause",
      reason: "ffmpeg detected audio below −35 dB; inspect before cutting",
      suggested: true,
    }),
  );
  p.data.assets
    .filter((a) => a.required)
    .forEach((a, i) => {
      const s = t.segments[Math.min(i, t.segments.length - 1)];
      markers.push({
        start: s.start,
        end: s.end,
        kind: a.kind === "screenshot" ? "screenshot" : "broll",
        reason: a.title,
        suggested: true,
      });
    });
  const keep: { start: number; end: number }[] = [];
  if (t.silences) {
    let cursor = 0;
    for (const s of t.silences) {
      const end = Math.min(t.duration, s.start + 0.15);
      if (end > cursor) keep.push({ start: cursor, end });
      cursor = Math.max(cursor, s.end - 0.15);
    }
    if (cursor < t.duration) keep.push({ start: cursor, end: t.duration });
  } else
    t.segments.forEach((s) => {
      const v = {
        start: Math.max(0, s.start - 0.15),
        end: Math.min(t.duration, s.end + 0.15),
      };
      const prev = keep.at(-1);
      if (prev && v.start <= prev.end) prev.end = Math.max(prev.end, v.end);
      else keep.push(v);
    });
  const words = (v: string) =>
    new Set(v.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const scriptWords = words(p.data.packet.teleprompter),
    heard = words(t.text);
  const coverage = scriptWords.size
    ? [...scriptWords].filter((w) => heard.has(w)).length / scriptWords.size
    : 0;
  return {
    script_coverage: Math.round(coverage * 100),
    script_review:
      "Token overlap is a review aid, not proof of faithful delivery. Compare the recording with the exact approved script.",
    media_id: t.media_id,
    markers: markers.sort(
      (a, b) => a.start - b.start || a.kind.localeCompare(b.kind),
    ),
    keep,
    reviewed: false,
    source_timing: true,
    algorithm: "deterministic/v1",
  };
}
function timestamp(seconds: number, separator: string) {
  const n = Math.round(seconds * 1000),
    ms = n % 1000,
    s = Math.floor(n / 1000) % 60,
    m = Math.floor(n / 60000) % 60,
    h = Math.floor(n / 3600000);
  return (
    [h, m, s].map((x) => String(x).padStart(2, "0")).join(":") +
    separator +
    String(ms).padStart(3, "0")
  );
}
export function subtitleAssets(t: Transcript) {
  const cues = t.segments.map((s, i) => ({
    start: s.start,
    end: s.end,
    text: s.text.replace(/<[^>]*>/g, "").replace(/-->/g, "→"),
    i: i + 1,
  }));
  const wrap = (text: string) =>
    text
      .split(/\s+/)
      .reduce<string[]>((lines, w) => {
        if (!lines.length || lines.at(-1)!.length + w.length > 42)
          lines.push(w);
        else lines[lines.length - 1] += " " + w;
        return lines;
      }, [])
      .join("\n");
  return {
    srt: cues
      .map(
        (s) =>
          `${s.i}\n${timestamp(s.start, ",")} --> ${timestamp(s.end, ",")}\n${wrap(s.text)}\n`,
      )
      .join("\n"),
    vtt:
      "WEBVTT\n\n" +
      cues
        .map(
          (s) =>
            `${timestamp(s.start, ".")} --> ${timestamp(s.end, ".")}\n${wrap(s.text)}\n`,
        )
        .join("\n"),
    json: JSON.stringify(
      {
        language: t.language,
        media_id: t.media_id,
        source_timing: true,
        segments: t.segments,
      },
      null,
      2,
    ),
  };
}
export function teleprompter(
  packets: ProductionPackage[],
  html = false,
  emphasis = false,
) {
  const text = packets
    .map((p) => p.data.packet.teleprompter)
    .join("\n\n\f\n\n");
  if (!html) return text;
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>BrainOS teleprompter · ${packets.map((p) => p.draft_id).join(" · ")}</title><style>body{background:#101816;color:#f5f1e7;font:clamp(30px,4vw,64px)/1.65 system-ui;margin:0 auto;max-width:960px;padding:12vh 8vw}p{margin:0 0 1.4em}section{break-after:page;padding-bottom:25vh}strong{color:#ebcf84}@media print{body{background:white;color:black}}</style>${packets
    .map(
      (p) =>
        `<section data-draft="${p.draft_id}" data-revision="${p.data.packet.revision}">${p.data.packet.teleprompter
          .split(/\n\s*\n/)
          .map(
            (chunk) =>
              `<p>${emphasis ? escapeHtml(chunk).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>") : escapeHtml(chunk)}</p>`,
          )
          .join("")}</section>`,
    )
    .join("")}</html>`;
}
export function renderIssues(p: ProductionPackage) {
  const issues: string[] = [];
  const media = p.data.media.find((m) => m.id === p.data.selected_media_id);
  if (!media?.owned_confirmed) issues.push("Owned recording required");
  if (!p.data.transcript?.reviewed)
    issues.push("Review transcript against the recording");
  if (!p.data.edit_plan?.reviewed)
    issues.push("Review the edit plan and cut points");
  p.data.assets
    .filter((a) => a.required)
    .forEach((a) => {
      if (
        a.rights !== "cleared" ||
        !a.publishable ||
        !a.basis.trim() ||
        !a.cleared_by ||
        !a.reference.trim()
      )
        issues.push(`${a.title}: rights or source file unresolved`);
    });
  return issues;
}
export function platformPackage(p: ProductionPackage) {
  const packet = p.data.packet,
    body = packet.script,
    first = body.split(/(?<=[.!?])\s/)[0] ?? body;
  return {
    story_id: p.story_id,
    draft_id: p.draft_id,
    revision: packet.revision,
    production_id: p.id,
    production_version: p.version,
    angle_id: p.data.angle_id,
    final_approval: p.data.approval,
    review_required: p.data.state !== "approved",
    short_video: {
      platforms: ["Reels", "TikTok", "Shorts"],
      script: packet.teleprompter,
      recording: packet,
      broll: p.data.assets,
      caption: [packet.hook, packet.cta].join("\n"),
      title_options: [packet.hook, p.data.title],
      cta: packet.cta,
      subtitles:
        p.data.output?.subtitles ??
        (p.data.transcript ? subtitleAssets(p.data.transcript) : null),
      source_subtitles: p.data.transcript
        ? subtitleAssets(p.data.transcript)
        : null,
      edit_plan: p.data.edit_plan,
      output: p.data.output,
    },
    x: {
      language: packet.language,
      post: `${packet.hook}\n${first}`.slice(0, 280),
      review_required: true,
    },
    newsletter: {
      headlines: [p.data.title, packet.hook],
      section: first,
      sources: packet.source_urls,
      review_required: true,
    },
    translation: null,
  };
}
export function assertMedia(p: ProductionPackage, id: string): RecordingMedia {
  const m = p.data.media.find((m) => m.id === id);
  if (!m || id !== p.data.selected_media_id)
    throw Error("Selected media missing");
  return m;
}
export function renderSpec(p: ProductionPackage, options: RenderOptions) {
  const issues = renderIssues(p);
  if (issues.length) throw Error(issues.join(". "));
  return {
    options,
    media: assertMedia(p, p.data.selected_media_id!),
    transcript: p.data.transcript!,
    plan: p.data.edit_plan!,
    asset_package: p.data.assets.filter((a) => a.required),
  };
}
