import type { Story, Source } from "../domain/types";
import { applyCommand } from "../domain/workflow";
import { adapters } from "./adapters";
import { eventKey, matchStory, primaryReferences } from "./dedup";
import {
  canonicalize,
  normalizedTitle,
  stableId,
  mediaIdentity,
} from "./normalize";
import { scoreDiscovery, suggestedAngles } from "./scoring";
import { sourceDefinitions } from "./registry";
import type {
  AdapterResult,
  Discovery,
  DiscoveryRecord,
  IngestionRun,
  IngestionStore,
  SourceAdapter,
  SourceDefinition,
} from "./types";
const unique = (values: string[]) => [...new Set(values)];
export function newStory(
  item: Discovery,
  source: SourceDefinition,
  now: string,
): Story {
  return {
    id: stableId(`live-story:${item.canonicalUrl}`),
    title: item.title,
    summary: item.excerpt.slice(0, 600),
    status: "detected",
    pillar:
      source.type === "research_feed"
        ? "Research to practice"
        : source.type === "official_release"
          ? "AI in practice"
          : /pric|enterprise|business/i.test(item.title)
            ? "AI for business"
            : "Tools, tested",
    story_type:
      source.type === "research_feed"
        ? "Research paper"
        : source.type === "official_release"
          ? "Product release"
          : "AI news",
    primary_language: "es",
    discovered_at: now,
    published_at: item.publishedAt,
    urgency: "unknown",
    confidence: "unknown",
    audience_relevance: "unknown",
    latam_relevance: "unknown",
    commercial_relevance: "unknown",
    why_matters:
      "Candidate discovery. Check the primary evidence before drawing conclusions.",
    latam_reason: "No established regional availability or applicability yet.",
    research_notes:
      "Feed material is unverified. Read the supporting excerpt and original source before marking any claim supported.",
    research_confirmed: false,
    priority: false,
    archived: false,
    is_demo: false,
    active_draft_id: null,
    production_completed: false,
    production_checklist: [],
    created_at: now,
    updated_at: now,
    version: 0,
    sources: [],
    claims: [],
    evidence: [],
    angles: [],
    drafts: [],
    assets: [],
    events: [],
    publications: [],
    discovery: {},
  };
}
export async function accumulate(
  original: Story | undefined,
  item: Discovery,
  source: SourceDefinition,
  reason: string,
  now: string,
): Promise<{ story: Story; sourceId: string; changed: boolean }> {
  let story = original
    ? structuredClone(original)
    : newStory(item, source, now);
  const sourceId = stableId(
    `source:${story.id}:${source.id}:${item.canonicalUrl}:${item.contentHash}`,
  );
  const duplicateSource = story.sources.some((s) => s.id === sourceId);
  const sourceKey = `${source.id}:${item.canonicalUrl}`;
  const previousSources = story.sources.filter(
    (s) => s.canonical_url === item.canonicalUrl && s.publisher === source.name,
  );
  const latest =
    previousSources.find(
      (s) => s.id === story.discovery?.latest_source_ids?.[sourceKey],
    ) ??
    previousSources.sort(
      (a, b) => Date.parse(b.retrieved_at) - Date.parse(a.retrieved_at),
    )[0];
  const changed =
    !!latest &&
    (latest.excerpt !== item.excerpt || latest.title !== item.title);
  if (duplicateSource) return { story, sourceId, changed: false };
  const retrieved = source.adapter !== "manual";
  const evidence: Source = {
    id: sourceId,
    story_id: story.id,
    url: item.originalUrl,
    canonical_url: item.canonicalUrl,
    tier:
      source.tier === 0
        ? "primary"
        : source.tier === 1
          ? "journalism"
          : "discovery",
    publisher: source.name,
    author: item.author,
    published_at: item.publishedAt,
    retrieved_at: now,
    type: `${source.type} · ${item.timestampNote}`,
    title: item.title,
    excerpt: item.excerpt,
    is_primary: source.tier === 0 && retrieved,
    reliability: source.reliability,
  };
  story.sources.push(evidence);
  if (retrieved) {
    const quote = item.excerpt.slice(0, 600);
    const claimId = stableId(`claim:${sourceId}`);
    story.claims.push({
      id: claimId,
      story_id: story.id,
      text: `${source.name} reports: “${quote}”`,
      confidence: evidence.is_primary ? "medium" : "unknown",
      verification_status: "unverified",
      notes:
        "Automatically retained publisher statement. Not independently verified; check scope and context before using it.",
    });
    story.evidence.push({
      id: stableId(`evidence:${sourceId}`),
      story_id: story.id,
      claim_id: claimId,
      source_id: sourceId,
      excerpt: quote,
      locator: `${source.adapter} entry ${item.externalId}; retained excerpt characters 1–${quote.length}`,
    });
  }
  for (const image of item.images) {
    const id = stableId(`asset:${story.id}:${mediaIdentity(image)}`);
    if (
      !story.assets.some(
        (a) =>
          a.id === id || mediaIdentity(a.source_url) === mediaIdentity(image),
      )
    )
      story.assets.push({
        id,
        story_id: story.id,
        draft_id: null,
        title: `Discovered image from ${source.name}`,
        type: "Feed image candidate",
        source_url: image,
        storage_url: null,
        publisher: source.name,
        retrieved_at: now,
        usage_basis: "Unknown. Presence in a public feed is not a license.",
        attribution: "Not yet established",
        publishable: false,
        rights_status: "unknown",
        notes: `Discovered at ${item.originalUrl}; file not downloaded.`,
        cleared_by: null,
        cleared_at: null,
      });
  }
  const previous = story.discovery ?? {};
  const oldBest = story.sources.find(
    (s) => s.id === previous.strongest_source_id,
  );
  const quality = (s: Source) =>
    s.is_primary && s.tier === "primary" ? 3 : s.tier === "journalism" ? 2 : 1;
  const stronger =
    !oldBest ||
    quality(evidence) > quality(oldBest) ||
    (quality(evidence) === quality(oldBest) &&
      evidence.canonical_url === oldBest.canonical_url);
  const score = scoreDiscovery(item, source, now);
  story.discovery = {
    ...previous,
    latest_source_ids: { ...previous.latest_source_ids, [sourceKey]: sourceId },
    source_times: {
      ...previous.source_times,
      [sourceId]: {
        updated_at: item.updatedAt,
        original_timestamp: item.originalTimestamp,
        timestamp_note: item.timestampNote,
        content_hash: item.contentHash,
        registry_id: source.id,
      },
    },
    strongest_source_id: stronger ? sourceId : oldBest.id,
    primary_evidence_status: story.sources.some((s) => s.is_primary)
      ? "retrieved"
      : "not_found",
    primary_references: unique([
      ...(previous.primary_references ?? []),
      ...item.primaryReferences,
    ]),
    entities: unique(
      [...(previous.entities ?? []), item.entity].filter(Boolean),
    ),
    normalized_titles: unique([
      ...(previous.normalized_titles ?? []),
      normalizedTitle(item.title),
    ]),
    event_keys: unique(
      [...(previous.event_keys ?? []), eventKey(item) ?? ""].filter(Boolean),
    ),
    scoring: stronger ? score : previous.scoring,
    suggestions: previous.suggestions ?? suggestedAngles(item),
    last_discovered_at: now,
    source_updated_at: stronger ? item.updatedAt : previous.source_updated_at,
    manual_only:
      source.adapter === "manual" ? (previous.manual_only ?? !original) : false,
    dedup_reason: reason,
  };
  if (stronger && story.status === "detected") {
    story.title = item.title;
    story.summary = item.excerpt.slice(0, 600);
    story.published_at = item.publishedAt;
    story.audience_relevance = score.dimensions.audience.level;
    story.latam_relevance = score.dimensions.latam.level;
    story.commercial_relevance = score.dimensions.commercial.level;
    story.urgency = score.dimensions.urgency.level;
    story.confidence = score.dimensions.confidence.level;
    story.why_matters =
      score.dimensions.audience.reasons.join(". ") +
      ". Suggested relevance, not an established outcome.";
    story.latam_reason = score.dimensions.latam.reasons.join(". ");
  }
  if (changed && original) {
    story.discovery.needs_review = true;
    if (
      [
        "drafted",
        "assets_cleared",
        "recording_needed",
        "render_ready",
        "review",
        "approved",
        "scheduled",
      ].includes(story.status)
    )
      story = await applyCommand(
        story,
        {
          type: "return_research",
          reason:
            "Ingested source text changed. Prior evidence and approvals are preserved in history; review the new excerpt.",
        },
        "Source ingestion",
        now,
      );
    else if (!["published", "measured"].includes(story.status))
      story.research_confirmed = false;
  }
  story.events.push({
    id: stableId(`discovery-event:${sourceId}`),
    story_id: story.id,
    type:
      source.adapter === "manual"
        ? "manual_discovery"
        : changed
          ? "source_changed"
          : "discovery",
    actor: source.adapter === "manual" ? "Daniel" : "Source ingestion",
    from_status: null,
    to_status: null,
    draft_id: null,
    detail:
      source.adapter === "manual"
        ? "Daniel flagged a story the system missed. Link and notes are an unverified lead."
        : `${source.name}: ${reason}. ${item.timestampNote}. ${changed ? "New source revision retained; old excerpts unchanged." : ""}`,
    created_at: now,
  });
  story.version = original ? original.version + 1 : 0;
  story.updated_at = now;
  return { story, sourceId, changed };
}
export async function persistDiscovery(
  store: IngestionStore,
  item: Discovery,
  source: SourceDefinition,
  owner: string,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await store.state();
    const id = stableId(
      `discovery:${source.id}:${item.externalId}:${item.contentHash}`,
    );
    if (state.records.some((r) => r.id === id))
      return {
        kind: "duplicate" as const,
        storyId: state.records.find((r) => r.id === id)!.story_id,
      };
    const result = matchStory(item, await store.readStories());
    const { story, sourceId, changed } = await accumulate(
      result.story,
      item,
      source,
      result.reason,
      item.fetchedAt,
    );
    const record: DiscoveryRecord = {
      id,
      registry_id: source.id,
      external_id: item.externalId,
      content_hash: item.contentHash,
      story_id: story.id,
      source_id: sourceId,
      canonical_url: item.canonicalUrl,
      discovered_at: item.fetchedAt,
      payload: item,
    };
    try {
      await store.commit(story, result.story?.version ?? -1, record, owner);
      return {
        kind: result.story
          ? changed
            ? ("updated" as const)
            : ("duplicate" as const)
          : ("new" as const),
        storyId: story.id,
      };
    } catch (error) {
      if (
        attempt === 2 ||
        !(error instanceof Error) ||
        !/Conflict|duplicate key/.test(error.message)
      )
        throw error;
    }
  }
  throw new Error("Could not persist discovery.");
}
export async function runIngestion(
  store: IngestionStore,
  options: {
    registry?: SourceDefinition[];
    adapters?: Record<string, SourceAdapter>;
    sourceIds?: string[];
    force?: boolean;
    now?: string;
    maxItems?: number;
    lookbackDays?: number;
  } = {},
) {
  const registry = options.registry ?? sourceDefinitions,
    sourceAdapters: Record<string, SourceAdapter> =
      options.adapters ?? adapters(),
    now = options.now ?? new Date().toISOString(),
    owner = crypto.randomUUID();
  await store.ensureSources(registry);
  if (
    options.sourceIds?.some(
      (id) => !registry.some((s) => s.id === id && s.adapter !== "manual"),
    )
  )
    throw new Error("Unknown or non-fetchable source ID.");
  if (!(await store.lease(owner)))
    throw new Error("An ingestion cycle is already running.");
  const completed: IngestionRun[] = [];
  const cache = new Map<string, AdapterResult>();
  try {
    const state = await store.state();
    const sources = state.registry
      .filter((s) =>
        options.sourceIds ? options.sourceIds.includes(s.id) : s.active,
      )
      .filter((s) => s.definition.adapter !== "manual");
    for (const entry of sources) {
      if (!(await store.lease(owner))) throw new Error("Ingestion lease lost.");
      const source = entry.definition;
      const run: IngestionRun = {
        id: crypto.randomUUID(),
        source_id: source.id,
        started_at: now,
        completed_at: null,
        status: "running",
        items_fetched: 0,
        new_stories: 0,
        deduplicated_items: 0,
        updated_items: 0,
        skipped_items: 0,
        errors: [],
      };
      await store.saveRun(run);
      let fetched: AdapterResult | undefined;
      try {
        const adapter = sourceAdapters[source.adapter];
        if (!adapter) throw new Error(`Adapter ${source.adapter} unavailable.`);
        // Only retry transient transport/server failures, never denied access or bad data.
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            fetched = await adapter.fetch(source, {
              now,
              etag: options.force ? null : entry.etag,
              lastModified: options.force ? null : entry.last_modified,
            });
            break;
          } catch (e) {
            if (
              attempt ||
              !(e instanceof Error) ||
              !/HTTP (429|5\d\d)|timeout|fetch failed/i.test(e.message)
            )
              throw e;
            await new Promise((resolve) => setTimeout(resolve, 750));
          }
        }
        if (!fetched) throw new Error("No source response.");
        cache.set(source.id, fetched);
        run.items_fetched = fetched.fetchedCount;
        let processed = 0;
        for (const incoming of fetched.items) {
          const releaseTag = decodeURIComponent(
            new URL(incoming.canonicalUrl).pathname.split(
              "/releases/tag/",
            )[1] ?? "",
          );
          if (source.ignoredReleaseTags?.includes(releaseTag)) {
            run.skipped_items++;
            continue;
          }
          const item = {
            ...incoming,
            primaryReferences: primaryReferences(incoming, registry),
          };
          const date = item.publishedAt ?? item.updatedAt;
          if (
            date &&
            Date.parse(now) - Date.parse(date) >
              (options.lookbackDays ?? 45) * 86400000
          ) {
            run.skipped_items++;
            continue;
          }
          const seen = (await store.state()).records.some(
            (r) =>
              r.registry_id === source.id &&
              r.external_id === item.externalId &&
              r.content_hash === item.contentHash,
          );
          if (seen) run.deduplicated_items++;
          if (!seen && processed++ >= (options.maxItems ?? 50)) {
            run.skipped_items++;
            run.errors.push(
              "Batch limit reached; remaining entries will be considered on the next run.",
            );
            continue;
          }
          try {
            if (!seen) {
              const outcome = await persistDiscovery(
                store,
                item,
                source,
                owner,
              );
              if (outcome.kind === "new") run.new_stories++;
              else if (outcome.kind === "updated") run.updated_items++;
              else run.deduplicated_items++;
            }
            // Follow explicit primary links through registered feeds, not broad web search or arbitrary crawling.
            if (source.tier > 0)
              for (const ref of item.primaryReferences.slice(0, 3)) {
                const primary = registry.find(
                  (s) =>
                    s.tier === 0 &&
                    s.primaryPrefixes.some((prefix) => ref.startsWith(prefix)),
                );
                if (!primary) continue;
                try {
                  let primaryFeed = cache.get(primary.id);
                  if (!primaryFeed || primaryFeed.notModified) {
                    primaryFeed = await sourceAdapters[primary.adapter].fetch(
                      primary,
                      { now },
                    );
                    cache.set(primary.id, primaryFeed);
                  }
                  const evidence = primaryFeed.items.find(
                    (i) => canonicalize(i.canonicalUrl) === ref,
                  );
                  if (!evidence)
                    throw new Error(
                      "Referenced primary item is not in the available feed; original evidence remains unresolved.",
                    );
                  await persistDiscovery(store, evidence, primary, owner);
                } catch (e) {
                  run.errors.push(
                    `Primary escalation ${ref}: ${e instanceof Error ? e.message : "failed"}`,
                  );
                }
              }
          } catch (e) {
            run.errors.push(
              `${item.originalUrl}: ${e instanceof Error ? e.message : "Item failed"}`,
            );
          }
        }
        run.status = run.errors.length ? "partial" : "success";
      } catch (e) {
        run.status = "failed";
        run.errors.push(e instanceof Error ? e.message : "Source failed");
      }
      run.completed_at = options.now ?? new Date().toISOString();
      await store.saveRun(run, {
        ...(fetched?.etag ? { etag: fetched.etag } : {}),
        ...(fetched?.lastModified
          ? { lastModified: fetched.lastModified }
          : {}),
      });
      completed.push(run);
    }
  } finally {
    await store.release(owner);
  }
  return completed;
}
