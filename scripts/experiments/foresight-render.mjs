/** One-story private render proof. No editorial inference, approval or publication. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import sharp from "sharp";

const sourceHash =
  "e5bf22a092d46a4a1b9f360b68da2b9189de84d82b904fb6de83c422c31d00f4";
const sourceUrl =
  "https://developers.google.com/static/edge/foresight/assets/enhanced-notetaking.gif";
const root = resolve(process.argv[2] ?? ".data/phase2/render");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const start = performance.now();
await mkdir(root, { recursive: true });
const source = await readFile(resolve(root, "source.gif"));
if (sha(source) !== sourceHash)
  throw Error("Official source bytes changed; reverify before rendering.");
const meta = await sharp(source, { animated: true }).metadata();
if (meta.width !== 786 || meta.pageHeight !== 474 || meta.pages !== 347)
  throw Error("Unexpected source dimensions/frames.");
const duration = meta.delay.reduce((a, b) => a + b, 0) / 1000;
const caption =
  "Google lanzó una app que toma notas de reuniones sin enviar el audio a la nube. AI Edge Foresight transcribe y convierte apuntes rápidos en notas usando modelos locales, según Google. También consulta tus documentos para responder preguntas durante la reunión. Está optimizada para Mac con Apple Silicon. La promesa es útil: menos apuntes, sin depender de una conexión. Falta comprobar su precisión en reuniones reales en español.";
const words = caption.split(/\s+/).length;
if (words < 40 || words > 80) throw Error("Editorial caption length failed.");
// This is a story-specific technical composition, not a reusable DVNI template.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350">
<rect width="1080" height="1350" fill="#e5e9f5"/>
<g fill="#141721" font-family="DejaVu Sans">
<text x="52" y="66" font-size="22" letter-spacing="3">IA LOCAL / GOOGLE</text>
<text x="50" y="176" font-size="79" font-weight="bold">La IA escucha.</text>
<text x="50" y="272" font-size="72" font-weight="bold">El audio se queda.</text>
<text x="52" y="346" font-size="25">GOOGLE AI EDGE FORESIGHT</text>
<path d="M52 373H1028" stroke="#555c70"/>
<text x="52" y="1130" font-size="34">Notas de reuniones sin conexión.</text>
<text x="52" y="1184" font-size="27">Optimizado para Mac con Apple Silicon.</text>
<text x="52" y="1240" font-size="21">Demostración oficial de Google. No es una prueba de DVNI.</text>
<text x="52" y="1294" font-size="20" font-weight="bold">PRUEBA PRIVADA · DERECHOS PENDIENTES · NO PUBLICAR</text>
</g></svg>`;
await sharp(Buffer.from(svg)).png().toFile(resolve(root, "composition.png"));
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
function run(args) {
  const r = spawnSync(
    ffmpeg,
    ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...args],
    { encoding: "utf8", timeout: 180000 },
  );
  if (r.status !== 0)
    throw Error(
      `ffmpeg failed (${r.status}): ${r.stderr?.slice(-800) ?? "timeout"}`,
    );
}
run([
  "-loop",
  "1",
  "-i",
  resolve(root, "composition.png"),
  "-i",
  resolve(root, "source.gif"),
  "-filter_complex",
  "[1:v]scale=1080:652:flags=lanczos,setsar=1[ui];[0:v][ui]overlay=0:405:shortest=1,format=yuv420p[v]",
  "-map",
  "[v]",
  "-an",
  "-t",
  String(duration),
  "-r",
  "30",
  "-c:v",
  "libx264",
  "-threads",
  "2",
  "-crf",
  "18",
  "-preset",
  "medium",
  "-movflags",
  "+faststart",
  resolve(root, "01.mp4"),
]);
run(["-i", resolve(root, "01.mp4"), "-f", "null", "-"]);
for (const [i, t] of [
  0,
  Math.floor(duration / 2),
  Math.max(0, duration - 1),
].entries()) {
  run([
    "-ss",
    String(t),
    "-i",
    resolve(root, "01.mp4"),
    "-frames:v",
    "1",
    resolve(root, `frame-${i}.png`),
  ]);
  const frame = await sharp(resolve(root, `frame-${i}.png`)).metadata();
  if (frame.width !== 1080 || frame.height !== 1350)
    throw Error("Output dimensions failed.");
}
const movie = await readFile(resolve(root, "01.mp4"));
if (movie.length > 30_000_000)
  throw Error("Output exceeds bounded private proof size.");
const result = {
  schema: "foresight-private-render-proof/v1",
  status: "HELD_NOT_A_PUBLICATION_CANDIDATE",
  publishable: false,
  editorial_execution:
    "Interactive engineering reference input; NOT unattended inference",
  rights: "UNCLEAR",
  rights_reason:
    "Official embedded product page says all rights reserved; no asset-specific publication license verified.",
  source: {
    url: sourceUrl,
    sha256: sourceHash,
    width: meta.width,
    height: meta.pageHeight,
    frames: meta.pages,
  },
  evidence: "https://developers.google.com/edge/foresight",
  output: {
    file: "01.mp4",
    sha256: sha(movie),
    bytes: movie.length,
    width: 1080,
    height: 1350,
    duration,
    fps: 30,
    audio: "none; source GIF is silent",
  },
  caption: {
    editorial_words: words,
    sha256: sha(Buffer.from(caption)),
    status: "REFERENCE_DRAFT_NOT_AUTONOMOUS",
  },
  qa: {
    full_decode: "passed",
    dimensions: "passed",
    source_checksum: "passed",
    human_or_model_visual_release: "NOT_APPROVED",
    mobile_ui_detail_readability: "REQUIRES_REVIEW",
    rights: "blocked",
  },
  render_seconds: Math.round((performance.now() - start) / 100) / 10,
  ffmpeg_version: spawnSync(ffmpeg, ["-version"], {
    encoding: "utf8",
  }).stdout.split("\n")[0],
  created_at: new Date().toISOString(),
  github_run_id: process.env.GITHUB_RUN_ID ?? null,
};
await writeFile(resolve(root, "caption-reference.txt"), caption);
await writeFile(resolve(root, "proof.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
