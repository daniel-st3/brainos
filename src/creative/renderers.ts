import { creativeHash as hash } from "./fingerprint";
import type { ControlState, Entity } from "../control/model";
import type { Story } from "../domain/types";
import {
  creativeRenderIssues,
  type CreativeRecord,
  type CreativeMedia,
} from "./model";

export type RenderMode = "static" | "motion";
export interface CreativeRenderInput {
  record: Entity<CreativeRecord>;
  mode: RenderMode;
}
export interface CreativeRenderOutput {
  renderer: string;
  renderer_version: string;
  specification_sha256: string;
  creative_id: string;
  creative_version: number;
  binding: CreativeRecord["package"]["binding"];
  files: {
    scene_id: string;
    mime: string;
    sha256: string;
    private_reference: string;
  }[];
  review_required: true;
  publishable: false;
}
export interface CreativeRenderer {
  id: string;
  version: string;
  modes: readonly RenderMode[];
  render(input: CreativeRenderInput): Promise<CreativeRenderOutput>;
}
export async function renderCreative(
  input: CreativeRenderInput,
  context: {
    state: ControlState;
    stories: Story[];
    media: CreativeMedia[];
  },
  renderers: readonly CreativeRenderer[] = [],
) {
  const current = context.state.entities.find(
    (e) => e.id === input.record.id && e.kind === "creative",
  );
  if (
    !current ||
    current.version !== input.record.version ||
    hash(current.data) !== hash(input.record.data)
  )
    throw Error("Creative render input is stale");
  const issues = creativeRenderIssues(
    input.record.data,
    context.state,
    context.stories,
    context.media,
  );
  if (input.mode === "motion" && !input.record.data.package.motion)
    issues.push("Explicit motion specification required");
  if (issues.length) throw Error(issues.join("; "));
  const renderer = renderers.find((r) => r.modes.includes(input.mode));
  if (!renderer)
    throw Error(
      `CREATIVE_RENDERER_NOT_CONFIGURED: ${input.mode}; no default DVNI template`,
    );
  const result = await renderer.render(input);
  if (
    result.specification_sha256 !== hash(input.record.data.package) ||
    result.creative_id !== input.record.id ||
    result.creative_version !== input.record.version ||
    hash(result.binding) !== hash(input.record.data.package.binding) ||
    result.publishable !== false ||
    result.review_required !== true ||
    result.renderer !== renderer.id ||
    result.renderer_version !== renderer.version
  )
    throw Error("Renderer returned unbound or unreviewed output");
  return result;
}
// Legacy working-card SVG/Sharp/PNG/carousel rendering stays in control/graphics and
// providers/raster/carousel. It is not advertised as a DVNI CreativeRenderer.
