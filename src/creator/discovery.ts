import { adapters, type Fetcher } from "../ingestion/adapters";
import { canonicalize } from "../ingestion/normalize";
import type { Discovery, SourceDefinition } from "../ingestion/types";
import type { Rpc } from "../ingestion/store";
import { randomUUID } from "node:crypto";

/** Independent experiment. Never passed to the pilot's ingestion store. */
export const creatorVersion = "creator-discovery/v1";
export const weights = {
  hook: 0.3,
  audience: 0.25,
  visual: 0.2,
  novelty: 0.15,
  evidence: 0.1,
} as const;
const feed = (
  id: string,
  name: string,
  endpoint: string,
  primary: boolean,
  origin: string,
): SourceDefinition => ({
  id: `creator-${id}`,
  name,
  endpoint,
  tier: primary ? 0 : 1,
  type: primary ? "official_blog" : "journalism",
  adapter: "feed",
  active: true,
  reliability: primary
    ? "Primary publisher; claims still require verification"
    : "Discovery signal; verify claims against primary source",
  topics: ["creator-experiment"],
  entities: [],
  primaryPrefixes: primary ? [origin] : [],
  itemPrefixes: [origin],
});
export const creatorSources = [
  feed(
    "openai",
    "OpenAI",
    "https://openai.com/news/rss.xml",
    true,
    "https://openai.com/",
  ),
  feed(
    "google",
    "Google AI",
    "https://blog.google/innovation-and-ai/technology/ai/rss/",
    true,
    "https://blog.google/",
  ),
  feed(
    "techcrunch",
    "TechCrunch AI",
    "https://techcrunch.com/category/artificial-intelligence/feed/",
    false,
    "https://techcrunch.com/",
  ),
  feed(
    "verge",
    "The Verge AI",
    "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
    false,
    "https://www.theverge.com/",
  ),
  feed(
    "wired",
    "WIRED AI",
    "https://www.wired.com/feed/tag/ai/latest/rss",
    false,
    "https://www.wired.com/",
  ),
  feed(
    "ars",
    "Ars Technica",
    "https://feeds.arstechnica.com/arstechnica/technology-lab",
    false,
    "https://arstechnica.com/",
  ),
];
export function weightedScore(
  dimensions: Record<keyof typeof weights, number>,
) {
  if (
    Object.values(dimensions).some(
      (n) => !Number.isFinite(n) || n < 0 || n > 100,
    )
  )
    throw Error("Invalid creator dimensions");
  return (
    Math.round(
      Object.entries(weights).reduce(
        (sum, [k, w]) => sum + dimensions[k as keyof typeof weights] * w,
        0,
      ) * 100,
    ) / 100
  );
}

/** Transparent triage proxies, NOT an assertion of quality or verified facts. */
export function qualify(
  item: Discovery,
  source: SourceDefinition,
  now: string,
) {
  const text = `${item.title} ${item.excerpt}`;
  const age = item.publishedAt
    ? (Date.parse(now) - Date.parse(item.publishedAt)) / 3600000
    : null;
  const relevant =
    /\b(ai|artificial intelligence|openai|anthropic|chatgpt|gemini|robot\w*|llm|agentic|grok)\b/i.test(
      text,
    );
  const hook =
    /\b(launch\w*|introduc\w*|new|first|unveil\w*|releas\w*|free|million|billion|robot\w*|interview|demo\w*)\b/i.test(
      item.title,
    );
  const practical =
    /\b(user\w*|people|video|image|creat\w*|work\w*|app\w*|tool\w*|search|automat\w*|robot\w*)\b/i.test(
      text,
    );
  const reasons = [
    ...(age === null
      ? ["PUBLICATION_TIME_UNKNOWN"]
      : age < -1
        ? ["FUTURE_PUBLICATION_TIME"]
        : age > 48
          ? ["OLDER_THAN_48_HOURS"]
          : []),
    ...(!relevant ? ["NO_AI_RELEVANCE_SIGNAL"] : []),
    ...(!hook ? ["HOOK_REQUIRES_EDITORIAL_REVIEW"] : []),
  ];
  const dimensions = {
    hook: hook ? 75 : 25,
    audience: relevant ? (practical ? 80 : 50) : 0,
    // A feed image is a lead, never a license or evidence of usable footage.
    visual: item.images.length
      ? 60
      : /video|demo|robot|screenshot/i.test(text)
        ? 35
        : 0,
    novelty:
      age !== null && age >= 0 && age <= 24
        ? 75
        : age !== null && age <= 48 && age >= 0
          ? 50
          : 0,
    evidence: source.tier === 0 ? 70 : 35,
  };
  return {
    url: canonicalize(item.canonicalUrl),
    title: item.title,
    source: source.name,
    source_id: source.id,
    published_at: item.publishedAt,
    discovered_at: item.fetchedAt,
    age_hours: age,
    excerpt: item.excerpt.slice(0, 1200),
    source_hash: item.contentHash,
    primary_source: source.tier === 0,
    evidence_links: item.links.slice(0, 12),
    media_candidates: item.images.map((url) => ({
      url,
      rights: "UNCLEAR",
      selected: false,
      downloaded: false,
    })),
    dimensions,
    score: weightedScore(dimensions),
    scoring_method: "explicit-keyword-and-feed-metadata-proxies/v1",
    reasons,
    eligible_for_research: reasons.length === 0,
    status: "STORY_BRIEF" as const,
    publishable: false,
    blockers: [
      "PRIMARY_CLAIMS_NOT_VERIFIED",
      "EDITORIAL_RUNTIME_NOT_CONNECTED",
      "FINAL_MEDIA_NOT_PRODUCED",
      "MEDIA_RIGHTS_NOT_CLEARED",
    ],
  };
}
export type CreatorBrief = ReturnType<typeof qualify>;
export interface CreatorSnapshot {
  schema: string;
  stage: "STAGING";
  output: "STORY_BRIEFS_ONLY";
  captured_at: string;
  weights: typeof weights;
  sources: {
    id: string;
    status: string;
    count: number;
    error: string | null;
  }[];
  briefs: CreatorBrief[];
  shortlist: string[];
  baseline_modified: false;
}
export async function collectCreatorBriefs(
  now: string,
  fetcher?: Fetcher,
): Promise<CreatorSnapshot> {
  const adapter = adapters(fetcher).feed;
  const results = await Promise.all(
    creatorSources.map(async (source) => {
      try {
        const result = await adapter.fetch(source, { now });
        return {
          health: {
            id: source.id,
            status: "HEALTHY",
            count: result.items.length,
            error: null,
          },
          briefs: result.items.map((item) => qualify(item, source, now)),
        };
      } catch {
        // Do not persist provider bodies or arbitrary exception text.
        return {
          health: {
            id: source.id,
            status: "FETCH_FAILED",
            count: 0,
            error: "PUBLIC_FEED_UNAVAILABLE_OR_INVALID",
          },
          briefs: [],
        };
      }
    }),
  );
  const unique = new Map<string, CreatorBrief>();
  for (const b of results.flatMap((r) => r.briefs)) {
    const previous = unique.get(b.url);
    if (!previous || b.score > previous.score) unique.set(b.url, b);
  }
  const briefs = [...unique.values()]
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
    .slice(0, 100);
  return {
    schema: creatorVersion,
    stage: "STAGING",
    output: "STORY_BRIEFS_ONLY",
    captured_at: now,
    weights,
    sources: results.map((r) => r.health),
    briefs,
    shortlist: briefs
      .filter((b) => b.eligible_for_research)
      .slice(0, 2)
      .map((b) => b.url),
    baseline_modified: false,
  };
}
export async function runCreatorDiscovery(
  rpc: Rpc,
  now = new Date().toISOString(),
  fetcher?: Fetcher,
) {
  // One snapshot per UTC hour, independent of caller retries or scheduled/manual triggers.
  const slot = now.slice(0, 13),
    owner = randomUUID();
  const claimed = await rpc("claim_creator_run", {
    p_slot: slot,
    p_owner: owner,
  });
  if (!claimed) return { status: "ALREADY_CLAIMED", slot };
  const snapshot = await collectCreatorBriefs(now, fetcher);
  await rpc("finish_creator_run", {
    p_slot: slot,
    p_owner: owner,
    p_snapshot: snapshot,
  });
  if (process.env.BRAINOS_AUTONOMOUS_STAGING === "true") {
    const { queueNewsroomRun } = await import("../newsroom/queue");
    await queueNewsroomRun(rpc, snapshot);
  }
  return {
    status: "STORY_BRIEFS_ONLY",
    slot,
    sources_healthy: snapshot.sources.filter((s) => s.status === "HEALTHY")
      .length,
    briefs: snapshot.briefs.length,
    shortlisted: snapshot.shortlist.length,
    publication_candidates: 0,
  };
}
