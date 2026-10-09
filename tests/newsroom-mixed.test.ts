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
it("keeps punch-in cuts inside the real source and refuses repeated/overlapping time ranges", () => {
  const input = structuredClone(scenes);
  const source = assets.map((a) => ({ ...a, width: 1616, height: 1080 }));
  const shots = [
    {
      start: 0,
      duration: 3,
      crop: { x: 100, y: 100, width: 800, height: 600 },
    },
    {
      start: 3,
      duration: 3,
      crop: { x: 100, y: 400, width: 800, height: 600 },
    },
  ];
  Object.assign(input[1].video, { shots });
  expect(() => validateScenes(input, source)).not.toThrow();
  shots[1].start = 2;
  expect(() => validateScenes(input, source)).toThrow("VIDEO_SHOT_BOUNDS");
  shots[1].start = 3;
  shots[1].crop.x = 1500;
  expect(() => validateScenes(input, source)).toThrow("VIDEO_SHOT_BOUNDS");
});
it("rejects unsafe timed explanations and cues that outlive the source clip", () => {
  const input = structuredClone(scenes);
  const cue = {
    start: 0,
    end: 6,
    svg: '<svg width="1080" height="1350"><text x="60" y="1100">Enviado</text></svg>',
  };
  Object.assign(input[1].video, { cues: [cue] });
  expect(() => validateScenes(input, assets)).not.toThrow();
  cue.end = 9;
  expect(() => validateScenes(input, assets)).toThrow("VIDEO_CUE_BOUNDS");
  cue.end = 6;
  cue.svg = cue.svg.replace("</svg>", "<script>alert(1)</script></svg>");
  expect(() => validateScenes(input, assets)).toThrow();
});
