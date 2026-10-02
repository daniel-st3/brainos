import type { Story } from "../domain/types";
import type { Provider } from "../control/model";
/** Public attribution has public publisher names/URLs only. Internal notes/IDs never enter copy. */
export function publicAttribution(story: Story, provider: Provider) {
  const sources = story.sources
    .filter((s) => s.is_primary)
    .flatMap((s) => {
      try {
        const u = new URL(s.canonical_url);
        if (
          u.protocol !== "https:" ||
          u.username ||
          u.password ||
          /^(localhost|127\.|192\.168\.|10\.)/.test(u.hostname) ||
          /\.supabase\.(co|in)$|^drive\.google\.com$|^docs\.google\.com$/.test(
            u.hostname,
          )
        )
          return [];
        u.search = "";
        u.hash = "";
        return [{ publisher: s.publisher.slice(0, 100), url: u.toString() }];
      } catch {
        return [];
      }
    });
  const text =
    provider === "x"
      ? sources
          .slice(0, 2)
          .map((s) => `${s.publisher}: ${s.url}`)
          .join("\n")
      : sources.map((s) => `${s.publisher} — ${s.url}`).join("\n");
  return {
    text,
    links: sources.map((s) => s.url),
    publishers: sources.map((s) => s.publisher),
    source_card_refs: [],
    version: "public-attribution/1",
  };
}
