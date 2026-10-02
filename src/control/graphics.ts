import { createHash } from "node:crypto";
import { escapeHtml } from "../production/model";
import type { Story } from "../domain/types";
export const design = {
  paper: "#f4f1e9",
  ink: "#172b26",
  accent: "#223b35",
  rule: "#adb9b0",
  font: "Arial, sans-serif",
  gutter: 72,
};
export interface GraphicInput {
  template: string;
  aspect: string;
  headline: string;
  text: string;
  source_ids: string[];
  slides: { headline: string; body: string }[];
}
export function renderGraphic(
  story: Story,
  contentId: string,
  revision: number,
  input: GraphicInput,
) {
  const sources = input.source_ids.map((id) => {
    const s = story.sources.find((s) => s.id === id);
    if (!s) throw Error("Retained source required");
    return s;
  });
  if (
    ["quote", "stat"].includes(input.template) &&
    (!input.text ||
      !sources[0].excerpt.includes(input.text) ||
      (input.template === "stat" && !/\d/.test(input.text)))
  )
    throw Error("Quote/stat must exactly match retained source evidence");
  if (
    input.template === "comparison" &&
    (sources.length !== 2 || sources[0].id === sources[1].id)
  )
    throw Error("Comparison requires two distinct sources");
  const dimensions: Record<string, [number, number]> = {
      "9:16": [1080, 1920],
      "1:1": [1080, 1080],
      "4:5": [1080, 1350],
      "16:9": [1920, 1080],
    },
    [w, h] = dimensions[input.aspect];
  const wrap = (copy: string, y: number, size: number, max: number) => {
    const width = Math.floor((w - 144) / (size * 0.54));
    const lines = copy.split(/\s+/).reduce<string[]>((out, word) => {
      if (!out.length || out.at(-1)!.length + word.length + 1 > width)
        out.push(word);
      else out[out.length - 1] += " " + word;
      return out;
    }, []);
    if (lines.length > max)
      throw Error(
        "Graphic copy exceeds template bounds; shorten it before rendering",
      );
    return lines
      .map(
        (l, i) =>
          `<text x="72" y="${y + i * size * 1.35}" font-size="${size}">${escapeHtml(l)}</text>`,
      )
      .join("");
  };
  const slides = input.slides.length
    ? input.slides
    : [
        {
          headline: input.headline,
          body:
            input.text ||
            sources.map((s) => s.excerpt.slice(0, 160)).join(" · "),
        },
      ];
  const outputs = slides.map((slide, i) => {
    const metadata = {
      template: input.template,
      template_version: 1,
      content_id: contentId,
      content_revision: revision,
      story_id: story.id,
      sources: sources.map((s) => ({
        id: s.id,
        url: s.canonical_url,
        attribution: s.publisher,
      })),
      rights: "unknown",
      slide: i,
    };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><metadata>${escapeHtml(JSON.stringify(metadata))}</metadata><rect width="${w}" height="${h}" fill="${design.paper}"/><rect width="${w}" height="16" fill="${design.accent}"/><g font-family="${design.font}" fill="${design.ink}"><text x="72" y="110" font-size="25" letter-spacing="3">DANIEL / ${escapeHtml(input.template.toUpperCase())} ${i + 1}/${slides.length}</text><path d="M72 155H${w - 72}" stroke="${design.rule}"/>${wrap(slide.headline, 245, 52, 5)}${wrap(slide.body, Math.min(650, h * 0.58), 30, Math.floor((h * 0.8 - Math.min(650, h * 0.58)) / 41))}<path d="M72 ${h - 215}H${w - 72}" stroke="${design.rule}"/>${wrap(sources.map((s) => s.publisher).join(" · "), h - 155, 22, 2)}<text x="72" y="${h - 48}" font-size="15">DERECHOS PENDIENTES · ${story.id}</text></g></svg>`;
    return {
      slide: i,
      svg,
      sha256: createHash("sha256").update(svg).digest("hex"),
      mime: "image/svg+xml",
      width: w,
      height: h,
    };
  });
  return {
    outputs,
    template_version: 1,
    source_ids: input.source_ids,
    story_id: story.id,
    content_id: contentId,
    content_revision: revision,
    aspect: input.aspect,
    sha256: createHash("sha256")
      .update(outputs.map((o) => o.sha256).join(""))
      .digest("hex"),
    rights: "unknown",
    publishable: false,
  };
}
