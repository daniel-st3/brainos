import type { EditorialAI } from "./ai";
import type { Angle, Platform, Story } from "../domain/types";
import { researchPacket } from "../operations/research";
function draft(story: Story, angle: Angle, platform: Platform) {
  const supported = story.claims.filter(
    (c) =>
      c.verification_status === "supported" &&
      story.evidence.some((e) => e.claim_id === c.id),
  );
  const facts = supported.map((c) => c.text).join("\n");
  const refs = story.sources
    .filter((s) =>
      story.evidence.some(
        (e) =>
          e.source_id === s.id && supported.some((c) => c.id === e.claim_id),
      ),
    )
    .map((s) => s.canonical_url)
    .join("\n");
  const caution =
    "Borrador de trabajo generado con plantilla. Revisar contexto, fuentes y afirmaciones antes de aprobar.";
  const formats = {
    short_video: "Face-led working script",
    instagram: "Editorial carousel",
    x: "Single post",
    newsletter: "Newsletter section",
  };
  let body = "";
  let hook = angle.text;
  if (platform === "short_video")
    body = `[0–5 s · Hook]\n${angle.text}\n\n[5–25 s · Qué está documentado]\n${facts}\n\n[25–45 s · Demostración propuesta]\nMostrar el producto real y una tarea concreta. No afirmar resultados que no se hayan medido.\n\n[45–60 s · Límite y cierre]\n${caution}\n\nFuentes:\n${refs}`;
  if (platform === "instagram")
    body = `Slide 1 · ${story.title}\nSlide 2 · Qué está documentado\n${facts}\nSlide 3 · Qué probar\nUna tarea, una métrica y revisión humana.\nSlide 4 · Límites\n${caution}\nSlide 5 · Fuentes\n${refs}\n\nAssets: captura propia del producto; tarjeta tipográfica; atribución visible.`;
  if (platform === "newsletter")
    body = `${story.title}\n\nÁngulo aprobado: ${angle.text}\n\nLo documentado:\n${facts}\n\nPróximo paso propuesto: probar un flujo pequeño y comparar con el proceso actual.\n\n${caution}\n\nLectura original:\n${refs}`;
  if (platform === "x") {
    hook = story.title.slice(0, 110);
    body = `Para evaluar: ${angle.text}`.slice(0, 160);
  }
  return {
    hook,
    body,
    cta: platform === "x" ? "" : "¿Qué probarías en tu flujo de trabajo?",
    target_duration: platform === "short_video" ? 60 : null,
    format: formats[platform],
    shot_notes:
      platform === "short_video"
        ? "A cámara: hook y cierre. Pantalla: captura propia con datos privados ocultos. B-roll: producto real o material propio. Medir primero; no inventar resultados."
        : "",
  };
}
export const liveEditorial: EditorialAI = {
  async researchStory(story) {
    return {
      notes: JSON.stringify(researchPacket(story), null, 2),
      provenance: "deterministic-evidence/v1",
    };
  },
  async extractClaims(story) {
    return story.claims.map((c) => ({
      ...c,
      verification_status: "unverified" as const,
    }));
  },
  async verifyClaims(story) {
    return story.claims.map((c) => ({
      claimId: c.id,
      suggestion:
        "Human verification required; automated extraction is not evidence verification.",
    }));
  },
  async suggestAngles(story) {
    return researchPacket(story).suggestions.map((s) => ({
      kind: s.kind as Angle["kind"],
      text: s.text,
      rationale:
        "System suggestion only. Human selection and explicit confirmation required.",
    }));
  },
  async generateDraft(story, angle, platform) {
    return draft(story, angle, platform);
  },
  async adaptDraftForPlatform(story, previous, platform) {
    const angle = story.angles.find((a) => a.id === previous.angle_id);
    if (!angle) throw new Error("Angle missing");
    return draft(story, angle, platform);
  },
};
