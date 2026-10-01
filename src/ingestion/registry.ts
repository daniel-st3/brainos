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
  release("google-adk", "Google · Agent Development Kit", "google/adk-python", [
    "google-adk",
  ]),
  {
    ...release(
      "llama-stack",
      "Llama Stack · Project releases",
      "llamastack/llama-stack",
      ["llama-stack"],
    ),
    active: false,
    reliability:
      "The feed now points to ogx-ai/ogx, outside its registered publisher scope. Inactive pending maintainer review; no evidence was ingested.",
  },
  release("langgraph", "LangChain · LangGraph", "langchain-ai/langgraph", [
    "langgraph",
  ]),
  release("vllm", "vLLM · Inference engine", "vllm-project/vllm", ["vllm"]),
  {
    ...release("n8n", "n8n · Workflow automation", "n8n-io/n8n", ["n8n"]),
    // These moving pointers duplicate the versioned releases in the same feed.
    ignoredReleaseTags: ["v1", "stable", "beta"],
  },
  {
    id: "huggingface-blog",
    name: "Hugging Face · Blog",
    endpoint: "https://huggingface.co/blog/feed.xml",
    tier: 0,
    type: "official_blog",
    adapter: "feed",
    active: false,
    reliability:
      "Official blog candidate. Network access was blocked here; feed contents have not been verified.",
    topics: ["models", "research", "open source"],
    entities: ["huggingface"],
    primaryPrefixes: ["https://huggingface.co/blog/"],
    itemPrefixes: ["https://huggingface.co/blog/"],
  },
  {
    id: "deepmind-blog",
    name: "Google DeepMind · Blog",
    endpoint: "https://deepmind.google/blog/rss.xml",
    tier: 0,
    type: "official_blog",
    adapter: "feed",
    active: false,
    reliability:
      "Official blog candidate. Network access was blocked here; endpoint and contents remain unverified.",
    topics: ["models", "research"],
    entities: ["deepmind"],
    primaryPrefixes: ["https://deepmind.google/blog/"],
    itemPrefixes: ["https://deepmind.google/blog/"],
  },
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
    id: "arxiv-ai",
    name: "arXiv · Artificial Intelligence",
    endpoint: "https://rss.arxiv.org/rss/cs.AI",
    tier: 0,
    type: "research_feed",
    adapter: "feed",
    active: false,
    reliability:
      "Author-supplied preprints, not peer-reviewed findings. Network access was blocked here; feed contents remain unverified.",
    topics: ["research", "preprints"],
    entities: [],
    primaryPrefixes: ["https://arxiv.org/abs/"],
    itemPrefixes: ["https://arxiv.org/abs/", "http://arxiv.org/abs/"],
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
