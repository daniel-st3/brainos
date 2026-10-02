import { createHash } from "node:crypto";
import type { Rpc } from "../ingestion/store";
import { controlSnapshot, readiness } from "../control/service";
import type { Content, Entity, Package, Provider } from "../control/model";

/** Navigation only. None of these destinations are fetched by the exporter. */
export const nativeDestinations = {
  instagram: {
    label: "Instagram",
    url: "https://www.instagram.com/",
    instructions:
      "Open Create in Instagram, select the downloaded media in order, and paste the approved caption. Review the account, audience, and preview before choosing Share yourself.",
    help: "https://help.instagram.com/442418472487929",
  },
  tiktok: {
    label: "TikTok Studio",
    url: "https://www.tiktok.com/tiktokstudio/upload",
    instructions:
      "Select the downloaded video in TikTok Studio and paste the approved caption. Review the account, audience, cover, and preview before choosing Post yourself. For a photo post, use Create in the TikTok mobile app.",
    help: "https://support.tiktok.com/en/using-tiktok/creating-videos/making-a-post",
  },
  x: {
    label: "X composer",
    url: "https://x.com/intent/post",
    instructions:
      "Paste the approved caption and attach downloaded media. If this is a thread, add each numbered post in order. Review the account and complete thread before choosing Post yourself.",
    help: "https://help.x.com/en/using-x/how-to-post",
  },
  youtube: {
    label: "YouTube Studio",
    url: "https://studio.youtube.com/",
    instructions:
      "Choose Create, then Upload videos. Select the downloaded video, paste the approved title and description, and add the subtitle file if supplied. Review channel, audience, visibility, and preview before choosing Publish yourself.",
    help: "https://support.google.com/youtube/answer/57407",
  },
  beehiiv: {
    label: "beehiiv dashboard",
    url: "https://app.beehiiv.com/",
    instructions:
      "Choose New, then Blank draft post. Paste the approved title, body, CTA, and attribution. Review publication, recipients, and web/email settings yourself. This handoff does not create a provider draft or send an email.",
    help: "https://www.beehiiv.com/support/article/26311866535575",
  },
} satisfies Record<
  Provider,
  { label: string; url: string; instructions: string; help: string }
>;

interface Asset {
  order: number;
  name: string;
  kind: "image" | "video" | "subtitles";
  mime: string;
  sha256: string;
  download: string;
}
type AssetSource =
  | { kind: "image"; graphic_id: string; source_sha256: string }
  | {
      kind: "video";
      production_id: string;
      provider: "local" | "supabase";
      file_id: string;
    }
  | { kind: "subtitles"; text: string };
export interface NativeHandoff {
  schema_version: 1;
  mode: "native_manual_handoff";
  exported_at: string;
  is_demo: boolean;
  package_id: string;
  package_version: number;
  fingerprint: string;
  platform: Provider;
  format: Content["format"];
  final_human_action_required: true;
  publication_status: "not_submitted";
  fresh_until: string | null;
  title: string;
  caption: string;
  cta: string;
  thread: string[];
  attribution: string;
  privacy: string | null;
  destination: (typeof nativeDestinations)[Provider];
  assets: Asset[];
  instructions: string[];
}
const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const validHash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

async function approvedInputs(
  rpc: Rpc,
  packageId: string,
  version: number,
  demo: boolean,
) {
  const snapshot = await controlSnapshot(rpc, demo);
  const p = snapshot.state.entities.find(
    (e) => e.kind === "package" && e.id === packageId,
  ) as Entity<Package> | undefined;
  if (!p || p.version !== version)
    throw Error("Exact package revision required; refresh and export again");
  const c = snapshot.state.entities.find(
    (e) => e.kind === "content" && e.id === p.parent_id,
  ) as Entity<Content> | undefined;
  if (
    !c ||
    p.data.content_id !== c.id ||
    p.data.platform !== c.data.platform ||
    p.data.draft_id !== c.draft_id ||
    p.data.draft_revision !== c.data.draft_revision
  )
    throw Error("Package/content revision mismatch");
  const check = readiness(
    c,
    snapshot.state,
    snapshot.stories,
    snapshot.production,
    p.id,
  );
  if (!check.ready) throw Error("Handoff blocked: " + check.issues.join("; "));
  const final = c.data.final_approval;
  if (
    !p.data.approved_by ||
    !p.data.approved_at ||
    !final?.actor ||
    !final.at ||
    final.package_id !== p.id ||
    final.package_version !== p.version ||
    final.fingerprint !== p.data.fingerprint
  )
    throw Error("Exact final human approval required");
  return { ...snapshot, p, c };
}

function assetsFor({
  p,
  c,
  state,
  production,
}: Awaited<ReturnType<typeof approvedInputs>>) {
  const assets: Omit<Asset, "download">[] = [],
    sources: AssetSource[] = [];
  const add = (
    asset: Omit<Asset, "download" | "order">,
    source: AssetSource,
  ) => {
    assets.push({ ...asset, order: assets.length + 1 });
    sources.push(source);
  };
  const prefix = `brainos-${p.data.platform}-${p.id.slice(0, 8)}-v${p.version}`;
  if (c.data.format === "video") {
    const pp = production.packages.find((x) => x.id === c.data.production_id),
      output = pp?.data.output;
    if (
      !pp ||
      !output ||
      !validHash(output.sha256) ||
      p.data.media_id !== output.file_id
    )
      throw Error("Exact approved video output required");
    add(
      {
        kind: "video",
        name: `${prefix}.mp4`,
        mime: "video/mp4",
        sha256: output.sha256,
      },
      {
        kind: "video",
        production_id: pp.id,
        provider: output.provider,
        file_id: output.file_id,
      },
    );
  }
  for (const id of p.data.graphic_ids) {
    const graphic = state.entities.find(
      (e) => e.kind === "graphic" && e.id === id,
    );
    if (!graphic || graphic.parent_id !== c.id)
      throw Error("Graphic belongs to another content item");
    const outputs = graphic.data.outputs as
      | {
          slide: number;
          sha256: string;
          png?: { sha256: string; source_svg_sha256: string };
        }[]
      | undefined;
    if (!outputs?.length)
      throw Error("Render the approved graphic PNGs before exporting");
    for (const [index, output] of outputs.entries()) {
      if (
        output.slide !== index ||
        !validHash(output.sha256) ||
        !validHash(output.png?.sha256) ||
        output.png?.source_svg_sha256 !== output.sha256
      )
        throw Error("Ordered current graphic PNGs required");
      add(
        {
          kind: "image",
          name: `${prefix}-${String(assets.length + 1).padStart(2, "0")}.png`,
          mime: "image/png",
          sha256: output.png.sha256,
        },
        { kind: "image", graphic_id: id, source_sha256: output.sha256 },
      );
    }
  }
  if (p.data.subtitles)
    add(
      {
        kind: "subtitles",
        name: `${prefix}.srt`,
        mime: "application/x-subrip",
        sha256: digest(p.data.subtitles),
      },
      { kind: "subtitles", text: p.data.subtitles },
    );
  if (p.data.platform === "youtube" && !assets.some((a) => a.kind === "video"))
    throw Error("YouTube handoff requires the exact approved video output");
  if (
    ["instagram", "tiktok"].includes(p.data.platform) &&
    !assets.some((a) => a.kind === "video" || a.kind === "image")
  )
    throw Error("This platform handoff requires approved downloadable media");
  return { assets, sources };
}

/** Read-only, allowlisted export: never include account secrets, media storage IDs, or signed URLs. */
export async function nativeHandoff(
  rpc: Rpc,
  packageId: string,
  version: number,
  demo: boolean,
  origin: string,
): Promise<NativeHandoff> {
  const app = new URL(origin);
  if (
    !["https:", "http:"].includes(app.protocol) ||
    app.username ||
    app.password ||
    app.origin !== origin
  )
    throw Error("Application origin required");
  const inputs = await approvedInputs(rpc, packageId, version, demo),
    { p, c } = inputs;
  const assets = assetsFor(inputs).assets.map((asset) => {
    const url = new URL("/api/control/handoff", origin);
    url.search = new URLSearchParams({
      package_id: p.id,
      package_version: String(p.version),
      asset: String(asset.order),
    }).toString();
    return { ...asset, download: url.href };
  });
  return {
    schema_version: 1,
    mode: "native_manual_handoff",
    exported_at: new Date().toISOString(),
    is_demo: demo,
    package_id: p.id,
    package_version: p.version,
    fingerprint: p.data.fingerprint,
    platform: p.data.platform,
    format: c.data.format,
    final_human_action_required: true,
    publication_status: "not_submitted",
    fresh_until: c.data.evergreen ? null : c.data.fresh_until,
    title: p.data.title,
    caption: p.data.caption,
    cta: p.data.cta,
    thread: [...p.data.thread],
    attribution: p.data.attribution?.text ?? "",
    privacy: p.data.privacy ?? null,
    destination: { ...nativeDestinations[p.data.platform] },
    assets,
    instructions: [
      ...(demo
        ? ["DEMO / FICTIONAL FIXTURE — do not publish this sample."]
        : []),
      "Download the numbered assets while signed in to BrainOS. Downloads recheck this exact approval and may become unavailable after revisions or evidence expiry.",
      nativeDestinations[p.data.platform].instructions,
      "Copy is the exact approved package. Keep its wording and asset order; return to BrainOS for a new review if you need edits. Keep required attribution with the post.",
      "Re-export immediately before publishing: an offline copy cannot detect later revocations or expired claims.",
      "Final action is yours in the platform. Exporting or opening a composer does not publish, schedule, or record a publication in BrainOS.",
    ],
  };
}

/** Asset reads stay authenticated; byte checks and a second approval check prevent stale downloads. */
export async function nativeHandoffAsset(
  rpc: Rpc,
  packageId: string,
  version: number,
  demo: boolean,
  order: number,
) {
  if (!Number.isSafeInteger(order) || order < 1)
    throw Error("Asset unavailable");
  const inputs = await approvedInputs(rpc, packageId, version, demo),
    { assets, sources } = assetsFor(inputs),
    asset = assets[order - 1],
    source = sources[order - 1];
  if (!asset || !source) throw Error("Asset unavailable");
  let bytes: Uint8Array;
  if (source.kind === "subtitles")
    bytes = new TextEncoder().encode(source.text);
  else if (source.kind === "image") {
    const { rasterBytes } = await import("./raster");
    bytes = await rasterBytes(source.graphic_id, source.source_sha256, demo);
  } else {
    if (
      !source.file_id.startsWith(source.production_id + "/") ||
      source.file_id.includes("..") ||
      source.file_id.includes("\\")
    )
      throw Error("Invalid output reference");
    if (source.provider === "local") {
      const [{ readFile }, path] = await Promise.all([
        import("node:fs/promises"),
        import("node:path"),
      ]);
      bytes = await readFile(
        path.resolve(
          process.env.CONTENT_OS_DATA_DIR ?? ".data/newsroom",
          "production",
          source.file_id,
        ),
      );
    } else {
      const { storageClient } = await import("../integrations/media");
      const { data, error } = await storageClient()
        .storage.from("brainos-production")
        .download(source.file_id);
      if (error || !data) throw Error("Private output unavailable");
      bytes = new Uint8Array(await data.arrayBuffer());
    }
  }
  if (digest(bytes) !== asset.sha256) throw Error("Asset checksum mismatch");
  const current = await approvedInputs(rpc, packageId, version, demo),
    latest = assetsFor(current).assets[order - 1];
  if (
    current.p.data.fingerprint !== inputs.p.data.fingerprint ||
    !latest ||
    latest.sha256 !== asset.sha256 ||
    latest.name !== asset.name
  )
    throw Error("Asset changed; export again");
  return { ...asset, bytes };
}

const escapeHtml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const copyScript = `document.querySelectorAll('button[data-copy]').forEach(function(button){button.addEventListener('click',async function(){var field=document.getElementById(button.dataset.copy);try{await navigator.clipboard.writeText(field.value);button.textContent='Copied';}catch(e){field.focus();field.select();button.textContent='Selected — press Ctrl/Cmd+C';}});});`;
export const handoffCsp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${createHash("sha256").update(copyScript).digest("base64")}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

export function renderNativeHandoff(
  bundle: NativeHandoff,
  format: "html" | "text" | "json",
) {
  if (format === "json") return JSON.stringify(bundle, null, 2);
  const fields = [
    ["Title", bundle.title],
    ["Caption / body", bundle.caption],
    ["CTA", bundle.cta],
    ["Attribution", bundle.attribution],
    ...bundle.thread.map((text, index) => [`Thread post ${index + 1}`, text]),
  ];
  if (format === "text")
    return [
      `BrainOS · ${bundle.destination.label} · MANUAL HANDOFF${bundle.is_demo ? " · DEMO" : ""}`,
      `Revision ${bundle.package_version} · ${bundle.package_id}`,
      `Exported: ${bundle.exported_at}`,
      ...(bundle.fresh_until ? [`Claims expire: ${bundle.fresh_until}`] : []),
      ...bundle.instructions,
      `Open: ${bundle.destination.url}`,
      `Official instructions: ${bundle.destination.help}`,
      ...fields.map(([label, value]) => `${label}\n${value}`),
      ...bundle.assets.map(
        (a) => `${a.order}. ${a.name}\n${a.download}\nSHA-256: ${a.sha256}`,
      ),
      `Visibility to review: ${bundle.privacy ?? "Choose in the platform"}`,
      "NOT SUBMITTED · Final human action required",
    ].join("\n\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(handoffCsp)}"><title>BrainOS · ${escapeHtml(bundle.destination.label)} handoff</title><style>body{font:16px/1.6 system-ui,sans-serif;background:#f6f4ee;color:#182a25;margin:0}main{max-width:850px;margin:auto;padding:32px 20px 80px}h1{font-size:clamp(28px,5vw,44px);line-height:1.1}section,.notice{background:#fff;border:1px solid #d7ddd8;border-radius:12px;padding:20px;margin:20px 0}textarea{display:block;box-sizing:border-box;width:100%;min-height:100px;font:inherit;line-height:1.5;padding:12px;border:1px solid #a9b7b1;border-radius:6px;resize:vertical}button,.open{display:inline-block;background:#234d40;color:#fff;border:0;border-radius:6px;padding:10px 16px;margin:10px 0;text-decoration:none;cursor:pointer}a{color:#234d40;overflow-wrap:anywhere}small{overflow-wrap:anywhere}li{margin:10px 0}h2{font-size:20px}.status{font-weight:700;color:#805100}</style></head><body><main><p>BrainOS · Native publishing handoff${bundle.is_demo ? " · DEMO" : ""}</p><h1>${escapeHtml(bundle.title)}</h1><p class="status">Not submitted · Final human action required</p><p>${escapeHtml(bundle.destination.label)} · Package revision ${bundle.package_version} · ${escapeHtml(bundle.exported_at)}</p><div class="notice"><ol>${bundle.instructions.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>${bundle.fresh_until ? `<p>Claims expire: ${escapeHtml(bundle.fresh_until)}</p>` : ""}<p>Visibility to review: ${escapeHtml(bundle.privacy ?? "Choose in the platform")}</p><a class="open" href="${escapeHtml(bundle.destination.url)}" target="_blank" rel="noopener noreferrer">Open ${escapeHtml(bundle.destination.label)}</a> <a href="${escapeHtml(bundle.destination.help)}" target="_blank" rel="noopener noreferrer">Official instructions</a></div>${fields.map(([label, value], i) => `<section><h2><label for="copy-${i}">${escapeHtml(label)}</label></h2><textarea id="copy-${i}" readonly spellcheck="false">${escapeHtml(value)}</textarea><button type="button" data-copy="copy-${i}" aria-live="polite">Copy ${escapeHtml(label)}</button></section>`).join("")}<section><h2>Download assets in this order</h2>${bundle.assets.length ? `<ol>${bundle.assets.map((a) => `<li><a href="${escapeHtml(a.download)}" rel="noreferrer">${escapeHtml(a.name)}</a><br><small>SHA-256: ${escapeHtml(a.sha256)}</small></li>`).join("")}</ol>` : "<p>This approved package contains no downloadable media.</p>"}<p>These links require your BrainOS session. Nothing has been made public.</p></section><small>Package ${escapeHtml(bundle.package_id)} · Fingerprint ${escapeHtml(bundle.fingerprint)}</small></main><script>${copyScript}</script></body></html>`;
}
