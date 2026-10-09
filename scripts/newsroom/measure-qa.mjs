// Read-only replay: no queue, new creative, uploads, notifications or publication.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { codexJSON } from "./codex.mjs";
import { visualQARequest } from "./pipeline.mjs";
const [input, output] = process.argv.slice(2).map((x) => path.resolve(x));
if (
  !input ||
  !output ||
  output === input ||
  output.startsWith(input + path.sep)
)
  throw Error("Supply a proof directory and a separate output directory");
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length)
  throw Error("Measurement output must be empty");
const result = JSON.parse(await fs.readFile(path.join(input, "result.json")));
const images = [
  ...result.media.map((_, i) => path.join(input, `mobile-${i + 1}.png`)),
  ...result.assets.map((_, i) => path.join(input, `asset-${i}.png`)),
];
const sha = (b) => createHash("sha256").update(b).digest("hex");
const originals = [
  ...images,
  ...result.media.map((m) => path.join(input, m.name)),
  path.join(input, "result.json"),
];
const before = await Promise.all(
  originals.map(async (file) => sha(await fs.readFile(file))),
);
for (let i = 0; i < result.media.length; i++)
  if (
    sha(await fs.readFile(path.join(input, result.media[i].name))) !==
    result.media[i].sha256
  )
    throw Error("Original media checksum mismatch");
const replay = await codexJSON({
  directory: output,
  name: "visual-qa-replay",
  images,
  ...visualQARequest({
    caption: result.caption,
    claims: result.claims,
    excerpt: result.source_excerpt,
    sourceURL: result.source_url,
    assets: result.assets,
  }),
});
const after = await Promise.all(
  originals.map(async (file) => sha(await fs.readFile(file))),
);
if (JSON.stringify(before) !== JSON.stringify(after))
  throw Error("Proof inputs changed");
const baseline = JSON.parse(
  await fs.readFile(path.join(input, "visual-qa-0.metrics.json")),
);
const total = (m) =>
  m.usage.reduce((n, u) => n + u.input_tokens + u.output_tokens, 0);
const report = {
  scope: "QA-only replay, not a new production run or whole-pipeline benchmark",
  inputs_unchanged: true,
  baseline_tokens: total(baseline),
  replay_tokens: total(replay.metrics),
  reduction_percent: 100 * (1 - total(replay.metrics) / total(baseline)),
  baseline_seconds: baseline.elapsed_seconds,
  replay_seconds: replay.metrics.elapsed_seconds,
  baseline_verdict: result.qa,
  replay_verdict: replay.value,
  label: replay.metrics.label,
};
await fs.writeFile(
  path.join(output, "comparison.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
