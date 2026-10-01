import type {
  Discovery,
  DiscoveryInsights,
  ScoreDimension,
  SourceDefinition,
} from "./types";
export function scoreDiscovery(
  item: Discovery,
  source: SourceDefinition,
  now: string,
): NonNullable<DiscoveryInsights["scoring"]> {
  const text = `${item.title}\n${item.excerpt}`.toLowerCase();
  const release = /\breleas|launch|introduc|new model/.test(text),
    workflow = /workflow|integrat|agent|automation|tool|sdk|api|python/.test(
      text,
    ),
    pricing = /pricing|price|billing|cost per|subscription/.test(text),
    enterprise = /enterprise|business|team|security|compliance/.test(text),
    research = /benchmark|research|paper|evaluation/.test(text);
  const local =
    /\b(colombia|latin america|latam|brazil|mexico|spanish|portuguese)\b/.test(
      text,
    );
  const age =
    (Date.parse(now) -
      Date.parse(item.publishedAt ?? item.updatedAt ?? item.fetchedAt)) /
    3600000;
  const dimension = (
    points: number,
    reasons: string[],
    unknown = false,
  ): ScoreDimension => ({
    points,
    level: unknown
      ? "unknown"
      : points >= 3
        ? "high"
        : points >= 1
          ? "medium"
          : "low",
    reasons,
  });
  const audienceReasons = [
    ...(workflow ? ["Practical workflow / developer-tool impact"] : []),
    ...(release ? ["Product or SDK release"] : []),
    ...(research ? ["Research / evaluation material"] : []),
  ];
  const dimensions = {
    audience: dimension(
      Math.min(4, (workflow ? 2 : 0) + (release ? 1 : 0) + (research ? 1 : 0)),
      audienceReasons.length
        ? audienceReasons
        : ["No clear applied-AI signal in the feed text"],
    ),
    latam: dimension(
      local ? 1 : 0,
      [
        local
          ? "Feed mentions a LATAM country or Spanish/Portuguese; regional availability still needs checking"
          : "No explicit LATAM or language evidence in the feed",
      ],
      !local,
    ),
    commercial: dimension((pricing ? 3 : 0) + (enterprise ? 1 : 0), [
      ...(pricing ? ["Pricing / billing change"] : []),
      ...(enterprise ? ["Business / enterprise implications"] : []),
      ...(!pricing && !enterprise ? ["Commercial impact not established"] : []),
    ]),
    urgency: dimension(age <= 24 ? 3 : age <= 72 ? 2 : age <= 168 ? 1 : 0, [
      `${item.publishedAt ? "Published" : item.updatedAt ? "Feed updated" : "Discovered"} ${Math.max(0, Math.floor(age))} hours ago`,
      ...(pricing ? ["Time-sensitive pricing information"] : []),
    ]),
    confidence: dimension(source.tier === 0 ? 2 : source.tier === 1 ? 1 : 0, [
      source.tier === 0
        ? "Retrieved publisher-maintained primary evidence; vendor claims are not independently verified"
        : source.tier === 1
          ? "Secondary reporting; primary evidence needs retrieval"
          : "Discovery lead only; original evidence not established",
    ]),
  };
  return {
    version: "heuristics/v1",
    scored_at: now,
    inputs: {
      registry_id: source.id,
      tier: source.tier,
      canonical_url: item.canonicalUrl,
      event_kind: item.eventKind,
      publication_time: item.publishedAt,
      feed_updated_at: item.updatedAt,
      workflow,
      pricing,
      enterprise,
      research,
      explicit_latam: local,
    },
    dimensions,
    total: Object.values(dimensions).reduce((sum, d) => sum + d.points, 0),
  };
}
export function suggestedAngles(item: Discovery) {
  return [
    {
      kind: "fast_news",
      text: `What changed in ${item.title}, and what is actually available?`,
      provenance: "system/angle-rules-v1",
    },
    {
      kind: "analysis",
      text: "Which reported change matters in a real workflow—and what evidence is still missing?",
      provenance: "system/angle-rules-v1",
    },
    {
      kind: "practical",
      text: "Design a small reproducible test before claiming better results.",
      provenance: "system/angle-rules-v1",
    },
  ];
}
