import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { initializeDb } from "../src/server/local-db";
import { DatabaseIngestionStore, localRpc } from "../src/ingestion/store";
import { canonicalize } from "../src/ingestion/normalize";
import { adapters, makeDiscovery, parseFeed } from "../src/ingestion/adapters";
import {
  accumulate,
  persistDiscovery,
  runIngestion,
} from "../src/ingestion/pipeline";
import { matchStory, primaryReferences } from "../src/ingestion/dedup";
import { scoreDiscovery } from "../src/ingestion/scoring";
import { sourceDefinitions } from "../src/ingestion/registry";
import {
  applyCommand,
  approvalIssues,
  clearanceIssues,
} from "../src/domain/workflow";
import { createDemoStories } from "../src/domain/seed";
import type {
  SourceDefinition,
  SourceAdapter,
  DiscoveryRecord,
} from "../src/ingestion/types";
const now = "2026-10-01T01:00:00.000Z";
const primary: SourceDefinition = {
  ...sourceDefinitions[0],
  id: "z-primary",
  name: "Fixture official publisher",
  endpoint: "https://official.example/feed",
  type: "official_blog",
  entities: ["test-product"],
  itemPrefixes: ["https://official.example/"],
  primaryPrefixes: ["https://official.example/news/"],
};
const secondary: SourceDefinition = {
  ...primary,
  id: "a-secondary",
  name: "Fixture journalism",
  tier: 1,
  type: "journalism",
  endpoint: "https://journal.example/feed",
  itemPrefixes: ["https://journal.example/"],
  primaryPrefixes: [],
};
const item = (
  source = primary,
  url = "https://official.example/news/launch",
  body = "Product 4.2 introduces an API for business workflows.",
) =>
  makeDiscovery(
    source,
    {
      id: url,
      url,
      title: "Product 4.2 new API release",
      body,
      published: "2026-09-30T12:30:00Z",
    },
    now,
  );
const report = () => {
  const d = item(
    secondary,
    "https://journal.example/report",
    'Analysis: <a href="https://official.example/news/launch?utm_source=press">official evidence</a>',
  );
  d.primaryReferences = primaryReferences(d, [primary, secondary]);
  return d;
};
let db: PGlite;
let store: DatabaseIngestionStore;
beforeAll(async () => {
  db = await initializeDb();
  store = new DatabaseIngestionStore(localRpc(db));
  await store.ensureSources([primary, secondary]);
});
afterAll(async () => db.close());

describe("URL identity and safe feed parsing", () => {
  it("removes tracking and fragments but preserves meaningful query parameters", () => {
    expect(
      canonicalize(
        "https://WWW.Example.com/news/?utm_source=x&b=2&a=1#section",
      ),
    ).toBe("https://example.com/news?a=1&b=2");
    expect(canonicalize("https://example.com/search?q=one")).not.toBe(
      canonicalize("https://example.com/search?q=two"),
    );
    expect(
      canonicalize("https://github.com/OpenAI/OpenAI-Python/releases/tag/v3.0"),
    ).toBe("https://github.com/openai/openai-python/releases/tag/v3.0");
    expect(() => canonicalize("javascript:alert(1)")).toThrow();
  });
  it("preserves Atom update time without fabricating publication time", () => {
    const [d] = parseFeed(
      '<feed><entry><id>x</id><title>Release</title><link href="https://official.example/news/x"/><updated>2026-09-30T09:00:00Z</updated><content>Actual publisher text.</content></entry></feed>',
      primary,
      now,
    );
    expect(d.publishedAt).toBeNull();
    expect(d.updatedAt).toBe("2026-09-30T09:00:00.000Z");
    expect(d.timestampNote).toContain("update time only");
  });
  it("uses RSS publication and trusted canonical links; rejects XML entities", () => {
    const [d] = parseFeed(
      "<rss><channel><item><guid>x</guid><title>Release</title><link>https://official.example/news/x?utm_source=x</link><pubDate>Wed, 30 Sep 2026 12:30:00 GMT</pubDate><description>Source excerpt</description></item></channel></rss>",
      primary,
      now,
    );
    expect(d.publishedAt).toBe("2026-09-30T12:30:00.000Z");
    expect(d.canonicalUrl).toBe("https://official.example/news/x");
    expect(() => parseFeed("<!DOCTYPE x><rss/>", primary, now)).toThrow("DTD");
  });
  it("supports conditional feed requests without parsing a 304", async () => {
    let headers: Record<string, string> | undefined;
    const result = await adapters(async (_url, h) => {
      headers = h;
      return { body: "", url: primary.endpoint, status: 304, contentType: "" };
    }).feed.fetch(primary, { now, etag: "etag-v1" });
    expect(headers?.["If-None-Match"]).toBe("etag-v1");
    expect(result.notModified).toBe(true);
  });
});

describe("deterministic clustering and provenance", () => {
  it("ignores rotating GitHub media signatures while preserving original URLs", async () => {
    const signed = (token: string) =>
      makeDiscovery(
        primary,
        {
          id: "signed",
          url: "https://official.example/news/signed",
          title: "A release with media",
          body: `Unchanged announcement <img src="https://private-user-images.githubusercontent.com/123/image.png?jwt=${token}"/>`,
          published: "2026-09-30T12:30:00Z",
        },
        now,
      );
    const first = signed("first-signature"),
      second = signed("rotated-signature");
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.images[0]).toContain("first-signature");
    const a = await accumulate(undefined, first, primary, "new", now);
    const b = await accumulate(a.story, second, primary, "same evidence", now);
    expect(b.story.sources).toHaveLength(1);
    expect(b.story.assets).toHaveLength(1);
    expect(b.story.assets[0].publishable).toBe(false);
  });
  it("keeps an existing roundup on its own story when it references multiple announcements", async () => {
    const a = (await accumulate(undefined, item(), primary, "new", now)).story;
    const b = (
      await accumulate(
        undefined,
        item(
          primary,
          "https://official.example/news/second",
          "Another announcement",
        ),
        primary,
        "new",
        now,
      )
    ).story;
    const roundup = report();
    roundup.primaryReferences.push(b.sources[0].canonical_url);
    const own = (
      await accumulate(
        undefined,
        roundup,
        secondary,
        "ambiguous references",
        now,
      )
    ).story;
    expect(matchStory(roundup, [a, b, own]).story?.id).toBe(own.id);
  });
  it("does not invalidate reconfirmed research for a timestamp-only refresh after a correction", async () => {
    const a = (await accumulate(undefined, item(), primary, "new", now)).story;
    const correction = item(primary, item().originalUrl, "Corrected statement");
    const b = (
      await accumulate(
        a,
        correction,
        primary,
        "correction",
        "2026-10-01T02:00:00Z",
      )
    ).story;
    b.research_confirmed = true;
    b.discovery!.needs_review = false;
    const refreshed = makeDiscovery(
      primary,
      {
        id: correction.externalId,
        url: correction.originalUrl,
        title: "Product 4.2 new API release",
        body: correction.excerpt,
        published: "2026-09-30T12:30:00Z",
        updated: "2026-10-01T03:00:00Z",
      },
      "2026-10-01T04:00:00Z",
    );
    const c = await accumulate(
      b,
      refreshed,
      primary,
      "feed refresh",
      "2026-10-01T04:00:00Z",
    );
    expect(c.changed).toBe(false);
    expect(c.story.research_confirmed).toBe(true);
    expect(c.story.discovery?.needs_review).toBe(false);
  });
  it("matches exact canonical URLs after tracking normalization", async () => {
    const a = await accumulate(undefined, item(), primary, "new", now);
    expect(
      matchStory(
        item(
          primary,
          "https://official.example/news/launch?utm_campaign=x#part",
        ),
        [a.story],
      ).story?.id,
    ).toBe(a.story.id);
  });
  it("consolidates secondary then primary, preserves sources and selects strongest", async () => {
    const a = await accumulate(undefined, report(), secondary, "new", now);
    const d = item();
    const found = matchStory(d, [a.story]);
    expect(found.story?.id).toBe(a.story.id);
    const b = await accumulate(found.story, d, primary, found.reason, now);
    expect(b.story.sources).toHaveLength(2);
    expect(b.story.discovery?.strongest_source_id).toBe(b.sourceId);
    expect(b.story.discovery?.primary_evidence_status).toBe("retrieved");
    expect(b.story.claims).toHaveLength(2);
    expect(
      b.story.evidence.every((e) =>
        b.story.sources.some(
          (s) => s.id === e.source_id && s.excerpt.includes(e.excerpt),
        ),
      ),
    ).toBe(true);
  });
  it("consolidates primary then secondary without demoting the best evidence", async () => {
    const a = await accumulate(undefined, item(), primary, "new", now);
    const found = matchStory(report(), [a.story]);
    expect(found.story?.id).toBe(a.story.id);
    const b = await accumulate(
      found.story,
      report(),
      secondary,
      found.reason,
      now,
    );
    expect(b.story.discovery?.strongest_source_id).toBe(a.sourceId);
    expect(b.story.sources).toHaveLength(2);
  });
  it("does not merge unrelated versions or ambiguous primary references", async () => {
    const a = (await accumulate(undefined, item(), primary, "new", now)).story;
    const other = makeDiscovery(
      primary,
      {
        id: "b",
        url: "https://official.example/news/other",
        title: "Product 5.0 new API release",
        body: "Different release",
        published: "2026-09-30T12:30:00Z",
      },
      now,
    );
    expect(matchStory(other, [a]).story).toBeUndefined();
    const b = (await accumulate(undefined, other, primary, "new", now)).story;
    const mixed = report();
    mixed.primaryReferences.push(other.canonicalUrl);
    expect(matchStory(mixed, [a, b]).reason).toContain("ambiguous");
  });
  it("never turns ingestion into verification, an opinion, or asset clearance", async () => {
    const d = item();
    d.images = ["https://official.example/media/screenshot.png"];
    const { story } = await accumulate(undefined, d, primary, "new", now);
    expect(story.status).toBe("detected");
    expect(story.research_confirmed).toBe(false);
    expect(story.angles).toEqual([]);
    expect(story.claims[0].verification_status).toBe("unverified");
    expect(story.assets[0].publishable).toBe(false);
    expect(story.assets[0].rights_status).toBe("unknown");
    const draft = {
      ...createDemoStories()[1].drafts[0],
      asset_ids: [story.assets[0].id],
    };
    expect(clearanceIssues(story, draft)).toHaveLength(1);
    await expect(
      applyCommand(story, { type: "transition", target: "verified" }, "Daniel"),
    ).rejects.toThrow();
  });
  it("invalidates approval and internal scheduling when an evidence excerpt changes", async () => {
    const d = item();
    const base = createDemoStories()[4];
    base.is_demo = false;
    const first = (
      await accumulate(base, d, primary, "additional evidence", now)
    ).story;
    const changed = (
      await accumulate(
        first,
        item(
          primary,
          d.originalUrl,
          "Correction: the earlier availability statement was withdrawn.",
        ),
        primary,
        "updated evidence",
        now,
      )
    ).story;
    expect(changed.status).toBe("researched");
    expect(changed.research_confirmed).toBe(false);
    expect(changed.discovery?.needs_review).toBe(true);
    expect(changed.publications.every((p) => p.status === "cancelled")).toBe(
      true,
    );
    expect(
      approvalIssues(
        changed,
        changed.drafts.find((d) => d.id === changed.active_draft_id),
      ),
    ).toContain(
      "Source text changed; check the new evidence and reconfirm research.",
    );
    expect(changed.sources.some((s) => s.excerpt === d.excerpt)).toBe(true);
  });
  it("produces repeatable, explainable scores without inventing LATAM availability", () => {
    const a = scoreDiscovery(item(), primary, now);
    expect(a).toEqual(scoreDiscovery(item(), primary, now));
    expect(a.dimensions.audience.reasons.length).toBeGreaterThan(0);
    expect(a.dimensions.latam.level).toBe("unknown");
    expect(a.dimensions.confidence.level).not.toBe("high");
  });
});

describe("durable ingestion and workflow isolation", () => {
  it("isolates a failed source, persists detected stories, escalates and remains idempotent", async () => {
    const failed: SourceDefinition = {
      ...primary,
      id: "broken",
      endpoint: "https://broken.example/feed",
      primaryPrefixes: ["https://broken.example/news/"],
    };
    const adapter: SourceAdapter = {
      fetch: async (s) => {
        if (s.id === "broken") throw new Error("HTTP 403 from blocked source");
        const items = s.id === secondary.id ? [report()] : [item()];
        return { items, fetchedCount: items.length };
      },
    };
    const opts = {
      registry: [failed, secondary, primary],
      adapters: { feed: adapter },
      now,
      force: true,
    };
    const first = await runIngestion(store, opts);
    expect(first.find((r) => r.source_id === "broken")?.status).toBe("failed");
    expect(first.filter((r) => r.status === "success")).toHaveLength(2);
    const stories = await store.readStories();
    expect(stories).toHaveLength(1);
    expect(stories[0].status).toBe("detected");
    expect(stories[0].sources).toHaveLength(2);
    const second = await runIngestion(store, opts);
    expect(second.reduce((n, r) => n + r.new_stories, 0)).toBe(0);
    expect(await store.readStories()).toEqual(stories);
    expect((await store.state()).records).toHaveLength(2);
    expect(
      (await store.state()).registry.find((s) => s.id === "broken")?.last_error,
    ).toContain("403");
  });
  it("serializes workers and rejects new or existing status shortcuts at the SQL boundary", async () => {
    const owner = crypto.randomUUID();
    expect(await store.lease(owner)).toBe(true);
    expect(await store.lease(crypto.randomUUID())).toBe(false);
    const story = (await store.readStories())[0];
    const d = item(primary, "https://official.example/news/next");
    const made = await accumulate(undefined, d, primary, "new", now);
    made.story.status = "verified";
    const record: DiscoveryRecord = {
      id: crypto.randomUUID(),
      registry_id: primary.id,
      external_id: d.externalId,
      content_hash: d.contentHash,
      story_id: made.story.id,
      source_id: made.sourceId,
      canonical_url: d.canonicalUrl,
      discovered_at: now,
      payload: d,
    };
    await expect(store.commit(made.story, -1, record, owner)).rejects.toThrow(
      "detected",
    );
    const jump = {
      ...story,
      status: "researched" as const,
      version: story.version + 1,
    };
    await expect(
      store.commit(jump, story.version, record, owner),
    ).rejects.toThrow("cannot advance");
    await store.release(owner);
    await expect(store.commit(made.story, -1, record, owner)).rejects.toThrow(
      "lease lost",
    );
  });
  it("records visible brief observations once and editorial actions transactionally", async () => {
    const story = (await store.readStories())[0];
    const brief = crypto.randomUUID();
    const args = {
      p_story: story.id,
      p_kind: "surfaced",
      p_brief: brief,
      p_rank: 2,
      p_actor: "Daniel",
    };
    await store.rpc("record_pilot", args);
    await store.rpc("record_pilot", args);
    const edited = await applyCommand(
      story,
      { type: "queue_research" },
      "Daniel",
      now,
    );
    await store.rpc("save_story", {
      p_story: edited,
      p_expected_version: story.version,
    });
    const events = (await store.state()).pilot;
    expect(events.filter((e) => e.kind === "surfaced")).toHaveLength(1);
    expect(events.find((e) => e.kind === "surfaced")?.rank).toBe(2);
    expect(events.some((e) => e.kind === "research_queued")).toBe(true);
  });
  it("retains a manual-only miss as an unverified lead without pretending to fetch evidence", async () => {
    const manual = sourceDefinitions.find((s) => s.id === "manual")!;
    await store.ensureSources([manual]);
    const d = makeDiscovery(
      manual,
      {
        id: "manual",
        url: "https://unknown.example/missed",
        title: "A missed fixture announcement",
        body: "Daniel noticed this.",
      },
      now,
    );
    const owner = crypto.randomUUID();
    await store.lease(owner);
    const result = await persistDiscovery(store, d, manual, owner);
    await store.release(owner);
    const story = (await store.readStories()).find(
      (s) => s.id === result.storyId,
    )!;
    expect(story.discovery?.manual_only).toBe(true);
    expect(story.claims).toHaveLength(0);
    expect(story.sources[0].is_primary).toBe(false);
    expect(
      (await store.state()).pilot.some(
        (e) => e.story_id === story.id && e.kind === "manual_miss",
      ),
    ).toBe(true);
  });
});

it("refetches a cached 304 feed when a secondary discovery needs unseen primary evidence", async () => {
  const fresh = await initializeDb();
  try {
    const isolated = new DatabaseIngestionStore(localRpc(fresh));
    const p = { ...primary, id: "first-primary" },
      s = { ...secondary, id: "second-secondary" };
    let primaryFetches = 0;
    const adapter: SourceAdapter = {
      fetch: async (source) => {
        if (source.id === p.id) {
          primaryFetches++;
          if (primaryFetches === 1)
            return { items: [], fetchedCount: 0, notModified: true };
          return { items: [item(p)], fetchedCount: 1 };
        }
        const discovery = item(
          s,
          "https://journal.example/report",
          '<a href="https://official.example/news/launch">Original announcement</a>',
        );
        return { items: [discovery], fetchedCount: 1 };
      },
    };
    const runs = await runIngestion(isolated, {
      registry: [p, s],
      adapters: { feed: adapter },
      now,
    });
    expect(runs.every((r) => r.status === "success")).toBe(true);
    expect(primaryFetches).toBe(2);
    const stories = await isolated.readStories();
    expect(stories).toHaveLength(1);
    expect(stories[0].sources).toHaveLength(2);
    expect(stories[0].discovery?.primary_evidence_status).toBe("retrieved");
    await expect(
      runIngestion(isolated, {
        registry: [p, s],
        sourceIds: ["typo"],
        adapters: { feed: adapter },
        now,
      }),
    ).rejects.toThrow("Unknown");
  } finally {
    await fresh.close();
  }
});

it("skips configured moving release pointers while retaining versioned announcements", async () => {
  const fresh = await initializeDb();
  try {
    const isolated = new DatabaseIngestionStore(localRpc(fresh));
    const source = sourceDefinitions.find((s) => s.id === "n8n")!;
    const items = ["stable", "beta", "v1", "n8n@2.42.1"].map((tag) =>
      makeDiscovery(
        source,
        {
          id: tag,
          url: `https://github.com/n8n-io/n8n/releases/tag/${encodeURIComponent(tag)}`,
          title: tag,
          body: "Fixture release",
          updated: now,
        },
        now,
      ),
    );
    const runs = await runIngestion(isolated, {
      registry: [source],
      now,
      adapters: { feed: { fetch: async () => ({ items, fetchedCount: 4 }) } },
    });
    expect(runs[0].skipped_items).toBe(3);
    expect(runs[0].new_stories).toBe(1);
    expect((await isolated.readStories())[0].title).toContain("2.42.1");
  } finally {
    await fresh.close();
  }
});
