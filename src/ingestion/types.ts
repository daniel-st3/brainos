import type { Level, Story } from "../domain/types";
export interface SourceDefinition {
  id: string;
  name: string;
  endpoint: string;
  tier: 0 | 1 | 2;
  type:
    | "official_release"
    | "official_blog"
    | "journalism"
    | "community"
    | "manual";
  adapter: "feed" | "github_api" | "manual";
  active: boolean;
  reliability: string;
  topics: string[];
  entities: string[];
  primaryPrefixes: string[];
  itemPrefixes: string[];
}
export interface RegistryEntry {
  id: string;
  definition: SourceDefinition;
  active: boolean;
  last_success_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  etag: string | null;
  last_modified: string | null;
}
export interface Discovery {
  externalId: string;
  originalUrl: string;
  canonicalUrl: string;
  title: string;
  excerpt: string;
  rawExcerpt: string;
  publishedAt: string | null;
  updatedAt: string | null;
  originalTimestamp: string | null;
  timestampNote: string;
  author: string;
  links: string[];
  images: string[];
  entity: string;
  version: string | null;
  eventKind: string;
  primaryReferences: string[];
  contentHash: string;
  fetchedAt: string;
  registryId: string;
}
export interface ScoreDimension {
  level: Level;
  points: number;
  reasons: string[];
}
export interface DiscoveryInsights {
  source_times?: Record<
    string,
    {
      updated_at: string | null;
      original_timestamp: string | null;
      timestamp_note: string;
      content_hash: string;
      registry_id: string;
    }
  >;
  strongest_source_id?: string;
  primary_evidence_status?: "retrieved" | "not_found" | "fetch_failed";
  primary_references?: string[];
  entities?: string[];
  normalized_titles?: string[];
  event_keys?: string[];
  scoring?: {
    version: string;
    scored_at: string;
    inputs: Record<string, string | number | boolean | null>;
    dimensions: Record<
      "audience" | "latam" | "commercial" | "urgency" | "confidence",
      ScoreDimension
    >;
    total: number;
  };
  suggestions?: { text: string; kind: string; provenance: string }[];
  last_discovered_at?: string;
  source_updated_at?: string | null;
  needs_review?: boolean;
  manual_only?: boolean;
  dedup_reason?: string;
  escalation_errors?: string[];
}
export interface IngestionRun {
  id: string;
  source_id: string;
  started_at: string;
  completed_at: string | null;
  status: "running" | "success" | "partial" | "failed";
  items_fetched: number;
  new_stories: number;
  deduplicated_items: number;
  updated_items: number;
  skipped_items: number;
  errors: string[];
}
export interface DiscoveryRecord {
  id: string;
  registry_id: string;
  external_id: string;
  content_hash: string;
  story_id: string;
  source_id: string;
  canonical_url: string;
  discovered_at: string;
  payload?: Discovery;
}
export interface PilotEvent {
  id: string;
  story_id: string;
  kind: string;
  brief_id: string | null;
  rank: number | null;
  actor: string;
  created_at: string;
}
export interface DiscoveryState {
  registry: RegistryEntry[];
  runs: IngestionRun[];
  records: DiscoveryRecord[];
  pilot: PilotEvent[];
}
export interface IngestionStore {
  readStories(): Promise<Story[]>;
  state(): Promise<DiscoveryState>;
  ensureSources(sources: SourceDefinition[]): Promise<void>;
  lease(owner: string): Promise<boolean>;
  release(owner: string): Promise<void>;
  saveRun(
    run: IngestionRun,
    headers?: { etag?: string; lastModified?: string },
  ): Promise<void>;
  commit(
    story: Story,
    expectedVersion: number,
    record: DiscoveryRecord,
    owner: string,
  ): Promise<void>;
}
export interface AdapterResult {
  items: Discovery[];
  fetchedCount: number;
  etag?: string;
  lastModified?: string;
  notModified?: boolean;
}
export interface SourceAdapter {
  fetch(
    source: SourceDefinition,
    options: {
      now: string;
      etag?: string | null;
      lastModified?: string | null;
    },
  ): Promise<AdapterResult>;
}
export interface SemanticMatcher {
  suggestCandidates(
    discovery: Discovery,
    stories: Story[],
  ): Promise<{ storyId: string; reason: string }[]>;
}
export interface ResearchEnhancer {
  suggest(
    discovery: Discovery,
  ): Promise<{ summary?: string; angles?: string[]; provenance: string }>;
}
