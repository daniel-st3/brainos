import type { EditorialAI } from "../services/ai";
import type { ControlState } from "./model";
import { editorialContext, activeBrand } from "./service";
/** Bound context is attached only to new unapproved output; never rewrite an approved revision. */
export function brandedGenerator(
  generator: EditorialAI,
  state: ControlState,
): EditorialAI {
  const brand = activeBrand(state);
  if (!brand) return generator;
  return {
    ...generator,
    async generateDraft(story, angle, platform) {
      const context = editorialContext(state, story.pillar, platform);
      if (angle.kind === "opinion" && !context.approved_takes.length)
        throw Error(
          "Approve a scoped Daniel take before generating opinion copy",
        );
      const output = await generator.generateDraft(story, angle, platform);
      return {
        ...output,
        cta: brand.data.cta,
        shot_notes: [
          output.shot_notes,
          `Brand ${context.brand_id} v${context.brand_version}; ${context.tone.join("; ")}. Human review required.`,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    },
    async adaptDraftForPlatform(story, draft, platform) {
      const output = await generator.adaptDraftForPlatform(
        story,
        draft,
        platform,
      );
      return {
        ...output,
        cta: brand.data.cta,
        shot_notes: `${output.shot_notes}\nBrand ${brand.id} v${brand.version}; platform ${platform}. Human review required.`,
      };
    },
  };
}
