import { rm } from "node:fs/promises";
import { initializeDb } from "../src/server/local-db";
import { DatabaseIngestionStore, localRpc } from "../src/ingestion/store";
import { runIngestion } from "../src/ingestion/pipeline";
import { makeDiscovery } from "../src/ingestion/adapters";
import type { SourceDefinition } from "../src/ingestion/types";
// Isolated browser fixture database. Never called by the app or real ingestion.
await rm(".data/e2e-live", { recursive: true, force: true });
const db = await initializeDb(".data/e2e-live");
const now = new Date().toISOString();
const primary: SourceDefinition = {
  id: "fixture-primary",
  name: "TEST · official evidence",
  endpoint: "https://official.example/feed",
  tier: 0,
  type: "official_blog",
  adapter: "feed",
  active: true,
  reliability: "Synthetic browser test fixture; not current news.",
  topics: ["API"],
  entities: ["test-product"],
  primaryPrefixes: ["https://official.example/news/"],
  itemPrefixes: ["https://official.example/"],
};
const secondary: SourceDefinition = {
  ...primary,
  id: "fixture-discovery",
  name: "TEST · discovery feed",
  tier: 1,
  type: "journalism",
  endpoint: "https://report.example/feed",
  itemPrefixes: ["https://report.example/"],
  primaryPrefixes: [],
};
try {
  await runIngestion(new DatabaseIngestionStore(localRpc(db)), {
    registry: [primary, secondary],
    now,
    adapters: {
      feed: {
        fetch: async (source) => {
          const input =
            source.id === primary.id
              ? {
                  id: "launch",
                  url: "https://official.example/news/launch",
                  title: "TEST FIXTURE — Product API launch",
                  body: "A synthetic workflow API announcement for browser verification.",
                  images: ["https://official.example/image.png"],
                }
              : {
                  id: "report",
                  url: "https://report.example/story",
                  title: "TEST FIXTURE — Coverage of the same launch",
                  body: 'Report links <a href="https://official.example/news/launch?utm_source=report">original announcement</a>.',
                };
          const items = [
            makeDiscovery(source, { ...input, published: now }, now),
          ];
          return { items, fetchedCount: items.length };
        },
      },
    },
  });
} finally {
  await db.close();
}
