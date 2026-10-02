import { createHash } from "node:crypto";
import { ProviderError, type Payload, type Remote } from "./client";
export type Simulation =
  | "success"
  | "delayed"
  | "transient"
  | "permanent"
  | "rate_limit"
  | "partial_thread";
/** Only injected in explicitly demo-labelled orchestration. Never available for live accounts. */
export class Simulator {
  constructor(
    private key: string,
    private mode: Simulation = "success",
  ) {}
  async publish(
    _account: string,
    p: Payload,
    r: Remote = {},
    save: (r: Remote) => Promise<void> = async () => {},
  ) {
    if (this.mode === "permanent")
      throw new ProviderError("SIMULATED_REJECTION");
    if (this.mode === "rate_limit")
      throw new ProviderError("RATE_LIMIT", true, false, 3600);
    if (this.mode === "transient" && !r.retried)
      throw new ProviderError("REMOTE_FAILURE", true, false);
    const id =
      "demo_" +
      createHash("sha256").update(this.key).digest("hex").slice(0, 16);
    if (this.mode === "partial_thread" && !r.ids) {
      await save({ ids: [id], next_index: 1, status: "dispatching" });
      throw new ProviderError("NETWORK_FAILURE", false, true);
    }
    return {
      id,
      url: `https://example.invalid/simulated/${id}`,
      status: this.mode === "delayed" ? "processing" : "published",
      synthetic: true,
      posts: p.thread.length || 1,
    };
  }
  async lookup(_account: string, r: Remote) {
    if (this.mode === "partial_thread") return { ...r, status: "uncertain" };
    return {
      ...r,
      status: "published",
      url: `https://example.invalid/simulated/${r.id}`,
      synthetic: true,
    };
  }
  async metrics() {
    return {
      raw: { fixture: "synthetic", views: 123, likes: 7 },
      values: { views: 123, likes: 7 },
      semantics: "simulator/v1",
      captured_at: new Date().toISOString(),
    };
  }
}
