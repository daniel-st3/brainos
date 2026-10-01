import type { Story } from "../domain/types";
import { escapeHtml } from "./model";
export type CardKind = "source" | "quote" | "stat" | "comparison";
export function graphic(
  story: Story,
  kind: CardKind,
  input: { source_id: string; second_source_id?: string; text?: string },
) {
  const source = story.sources.find((s) => s.id === input.source_id);
  if (!source) throw Error("A retained story source is required");
  let title = story.title,
    body = source.excerpt.slice(0, 360),
    refs = [source];
  if (kind === "quote" || kind === "stat") {
    if (
      !input.text?.trim() ||
      input.text.length > 300 ||
      !source.excerpt.includes(input.text)
    )
      throw Error(
        "Quote/stat must be an exact retained source excerpt (300 characters maximum)",
      );
    if (kind === "stat" && !/\d/.test(input.text))
      throw Error("Stat excerpt must include a number");
    title = input.text;
    body =
      kind === "quote"
        ? "Cita atribuida · revisar contexto y derechos"
        : "Dato de la fuente · revisar unidad, fecha y contexto";
  }
  if (kind === "comparison") {
    const other = story.sources.find((s) => s.id === input.second_source_id);
    if (!other || other.id === source.id)
      throw Error("Choose two different retained sources");
    refs = [source, other];
    title = "Dos fuentes, lado a lado";
    body = `${source.publisher}: ${source.excerpt.slice(0, 155)}\n\n${other.publisher}: ${other.excerpt.slice(0, 155)}`;
  }
  const lines = (text: string, width: number) =>
    text.split(/\s+/).reduce<string[]>((a, w) => {
      if (!a.length || a.at(-1)!.length + w.length > width) a.push(w);
      else a[a.length - 1] += " " + w;
      return a;
    }, []);
  const text = (
    s: string,
    y: number,
    size: number,
    width: number,
    max: number,
  ) =>
    lines(s, width)
      .slice(0, max)
      .map(
        (l, i) =>
          `<text x="80" y="${y + i * size * 1.4}" font-size="${size}">${escapeHtml(l)}</text>`,
      )
      .join("");
  const metadata = {
    story_id: story.id,
    kind,
    sources: refs.map((s) => ({
      id: s.id,
      url: s.canonical_url,
      attribution: s.publisher,
    })),
    rights_status: "unknown",
    publishable: false,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><metadata>${escapeHtml(JSON.stringify(metadata))}</metadata><rect width="1080" height="1350" fill="#f4f1e9"/><rect x="0" y="0" width="1080" height="18" fill="#223b35"/><g font-family="Arial,sans-serif" fill="#172b26"><text x="80" y="106" font-size="25" letter-spacing="3">BRAINOS / ${kind.toUpperCase()}</text><path d="M80 150H1000" stroke="#adb9b0"/>${text(title, 238, 48, 36, 5)}${text(body, 640, 28, 62, 9)}<path d="M80 1050H1000" stroke="#adb9b0"/>${refs.map((s, i) => text(`${s.publisher} · ${s.canonical_url}`, 1100 + i * 76, 18, 90, 2)).join("")}<text x="80" y="1300" font-size="15">${story.id} · BORRADOR / DERECHOS PENDIENTES</text></g></svg>`;
}
