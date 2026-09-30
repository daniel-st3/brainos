import type { Angle, Claim, Draft, Platform, Story } from "@/domain/types";
export interface EditorialAI {
  researchStory(story: Story): Promise<{ notes: string; provenance: string }>;
  extractClaims(story: Story): Promise<Claim[]>;
  verifyClaims(
    story: Story,
  ): Promise<{ claimId: string; suggestion: string }[]>;
  suggestAngles(
    story: Story,
  ): Promise<Pick<Angle, "text" | "rationale" | "kind">[]>;
  generateDraft(
    story: Story,
    angle: Angle,
    platform: Platform,
  ): Promise<
    Pick<
      Draft,
      "hook" | "body" | "cta" | "target_duration" | "format" | "shot_notes"
    >
  >;
  adaptDraftForPlatform(
    story: Story,
    draft: Draft,
    platform: Platform,
  ): Promise<
    Pick<
      Draft,
      "hook" | "body" | "cta" | "target_duration" | "format" | "shot_notes"
    >
  >;
}
// Deterministic fixtures. Never assert external verification or impersonate the creator.
export const demoAI: EditorialAI = {
  async researchStory(story) {
    return {
      notes: `DEMO · Research aid\n${story.summary}\nOpen each linked source and check the supporting excerpt. No live retrieval was performed.`,
      provenance: "deterministic-demo/v1",
    };
  },
  async extractClaims(story) {
    return story.claims.map((c) => ({
      ...c,
      verification_status: "unverified",
    }));
  },
  async verifyClaims(story) {
    return story.claims.map((c) => ({
      claimId: c.id,
      suggestion: "Human verification required; this mock cannot verify facts.",
    }));
  },
  async suggestAngles(story) {
    return [
      {
        kind: "fast_news",
        text: `Qué cambia: ${story.title.toLowerCase()}`,
        rationale:
          "Separate the documented change from the announcement’s promise.",
      },
      {
        kind: "opinion",
        text: "La ventaja no está en la herramienta, sino en elegir bien el problema.",
        rationale: "Proposed take only. Daniel must decide whether he agrees.",
      },
      {
        kind: "practical",
        text: "Una prueba pequeña, un flujo real y una métrica antes de escalar.",
        rationale: `Build a reproducible test for ${story.pillar.toLowerCase()}; do not claim it has already been run.`,
      },
    ];
  },
  async generateDraft(story, angle, platform) {
    const short = platform === "x";
    return {
      hook: short
        ? "Una prueba antes de escalar."
        : "Antes de automatizar, decide qué vas a medir.",
      body: short
        ? "Propuesta de experimento: elegir una tarea repetitiva, medir el punto de partida y revisar cada resultado. Material de demostración; resultados pendientes."
        : `[DEMO · Guion de práctica, no noticia verificada]\n\n${angle.text}\n\nContexto: ${story.summary}\n\nPropuesta: elegir una tarea acotada, registrar el proceso actual y comparar el resultado con revisión humana.\n\nLímite: este ejemplo no demuestra resultados reales. Confirmar las fuentes y realizar la prueba antes de afirmar mejoras.`,
      cta: short ? "" : "¿Qué tarea probarías primero?",
      target_duration: platform === "short_video" ? 60 : null,
      format:
        platform === "short_video"
          ? "Face-led outline"
          : platform === "instagram"
            ? "News card copy"
            : platform === "x"
              ? "Single post"
              : "Newsletter note",
      shot_notes:
        platform === "short_video"
          ? "Face to camera for the hook. Record the actual screen with private details removed. Show the baseline and the result only after testing."
          : "",
    };
  },
  async adaptDraftForPlatform(story, draft, platform) {
    const angle = story.angles.find((a) => a.id === draft.angle_id);
    if (!angle) throw new Error("Angle missing");
    return this.generateDraft(story, angle, platform);
  },
};
