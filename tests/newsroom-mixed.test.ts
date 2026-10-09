import { expect, it } from "vitest";
import {
  validateScenes,
  perceptualDuplicates,
} from "../scripts/newsroom/mixed.mjs";
import sharp from "sharp";
const assets = Array.from({ length: 4 }, (_, i) => ({
  sha256: String(i),
  mime: i === 1 ? "video/mp4" : "image/png",
  duration: 8,
}));
const scenes = assets.map((_, i) => ({
  type: i === 1 ? "video" : "image",
  asset: i,
  svg: `<svg width="1080" height="1350"><image href="asset:${i}" x="40" y="400" width="1000" height="600"/></svg>`,
  video: { x: 40, y: 400, width: 1000, height: 600, start: 0, duration: 6 },
}));
it("validates ordered source-backed video and refuses repeated assets, untrusted SVG, out-of-frame or excessive-duration video", () => {
  expect(() => validateScenes(scenes, assets)).not.toThrow();
  for (const [field, value] of [
    ["width", 9999],
    ["duration", 10],
    ["start", -1],
  ]) {
    const bad = structuredClone(scenes);
    Object.assign(bad[1].video, { [field]: value });
    expect(() => validateScenes(bad, assets)).toThrow();
  }
  const repeat = structuredClone(assets);
  repeat[2].sha256 = repeat[0].sha256;
  expect(() => validateScenes(scenes, repeat)).toThrow("REPEATED_SOURCE");
  const bad = structuredClone(scenes);
  bad[0].svg = bad[0].svg.replace("asset:0", "file:///etc/passwd");
  expect(() => validateScenes(bad, assets)).toThrow();
});
it("flags perceptually identical sources even with different encodings", async () => {
  const png = await sharp({
    create: { width: 50, height: 50, channels: 3, background: "#ababab" },
  })
    .png()
    .toBuffer();
  const jpg = await sharp(png).jpeg().toBuffer();
  expect(await perceptualDuplicates([png, jpg])).toHaveLength(1);
});
