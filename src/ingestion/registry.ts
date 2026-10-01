import type { SourceDefinition } from "./types";
const release = (
  id: string,
  name: string,
  repo: string,
  entities: string[],
): SourceDefinition => ({
  id,
  name,
  endpoint: `https://github.com/${repo}/releases.atom`,
  tier: 0,
  type: "official_release",
  adapter: "feed",
  active: true,
  reliability:
    "Publisher-maintained release feed. Evidence of what the project reports; not independent verification.",
  topics: ["developer tools", "applied AI"],
  entities,
  primaryPrefixes: [`https://github.com/${repo}/releases/tag/`],
  itemPrefixes: [`https://github.com/${repo}/releases/tag/`],
});
/** Maintainer-reviewed registry. Add a definition to onboard a source; health is persisted separately. */
export const sourceDefinitions: SourceDefinition[] = [
  release("openai-python", "OpenAI · Python SDK", "openai/openai-python", [
    "openai-python",
  ]),
  release(
    "anthropic-python",
    "Anthropic · Python SDK",
    "anthropics/anthropic-sdk-python",
    ["anthropic-sdk-python"],
  ),
  release(
    "transformers",
    "Hugging Face · Transformers",
    "huggingface/transformers",
    ["transformers"],
  ),
  release(
    "semantic-kernel",
    "Microsoft · Semantic Kernel",
    "microsoft/semantic-kernel",
    ["semantic-kernel"],
  ),
  {
    id: "openai-news",
    name: "OpenAI · Newsroom",
    endpoint: "https://openai.com/news/rss.xml",
    tier: 0,
    type: "official_blog",
    adapter: "feed",
    active: false,
    reliability:
      "Official announcement feed; claims still require human verification.",
    topics: ["models", "API", "research"],
    entities: ["openai"],
    primaryPrefixes: ["https://openai.com/index/"],
    itemPrefixes: ["https://openai.com/"],
  },
  {
    id: "google-ai",
    name: "Google · AI blog",
    endpoint: "https://blog.google/technology/ai/rss/",
    tier: 0,
    type: "official_blog",
    adapter: "feed",
    active: false,
    reliability:
      "Official publisher feed. Endpoint has not been verified in this environment.",
    topics: ["AI", "products"],
    entities: ["google"],
    primaryPrefixes: ["https://blog.google/technology/ai/"],
    itemPrefixes: ["https://blog.google/"],
  },
  {
    id: "manual",
    name: "Daniel · missed-story reports",
    endpoint: "https://example.invalid/manual",
    tier: 2,
    type: "manual",
    adapter: "manual",
    active: false,
    reliability:
      "Manually supplied lead; source contents have not yet been retrieved.",
    topics: [],
    entities: [],
    primaryPrefixes: [],
    itemPrefixes: [],
  },
];
