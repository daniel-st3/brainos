import { createClient } from "@supabase/supabase-js";
import type { PGlite } from "@electric-sql/pglite";
import { localDb } from "../server/local-db";
import type { Story } from "../domain/types";
import type {
  DiscoveryRecord,
  DiscoveryState,
  IngestionRun,
  IngestionStore,
  SourceDefinition,
} from "./types";
export type Rpc = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
export function localRpc(db: PGlite): Rpc {
  return async (name, args = {}) => {
    if (
      !/^[a-z_]+$/.test(name) ||
      Object.keys(args).some((k) => !/^[a-z_]+$/.test(k))
    )
      throw new Error("Invalid RPC name");
    const entries = Object.entries(args);
    const result = await db.query<{ result: unknown }>(
      `select public.${name}(${entries.map(([k], i) => `${k} => $${i + 1}`).join(",")}) as result`,
      entries.map(([, v]) =>
        v !== null && typeof v === "object" ? JSON.stringify(v) : v,
      ),
    );
    return result.rows[0]?.result;
  };
}
export async function applicationRpc(): Promise<Rpc> {
  if (process.env.CONTENT_OS_MODE !== "supabase")
    return localRpc(await localDb());
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key)
    throw new Error("Supabase URL and server secret are required.");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return async (name, args = {}) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error(error.message);
    return data;
  };
}
export class DatabaseIngestionStore implements IngestionStore {
  constructor(public rpc: Rpc) {}
  async readStories() {
    return (await this.rpc("read_newsroom")) as Story[];
  }
  async state() {
    return (await this.rpc("read_discovery_state")) as DiscoveryState;
  }
  async ensureSources(sources: SourceDefinition[]) {
    await this.rpc("ensure_sources", { p_sources: sources });
  }
  async lease(owner: string) {
    return (await this.rpc("claim_ingestion", { p_owner: owner })) as boolean;
  }
  async release(owner: string) {
    await this.rpc("release_ingestion", { p_owner: owner });
  }
  async saveRun(run: IngestionRun, headers: Record<string, string> = {}) {
    await this.rpc("save_ingestion_run", { p_run: run, p_headers: headers });
  }
  async commit(
    story: Story,
    expectedVersion: number,
    record: DiscoveryRecord,
    owner: string,
  ) {
    await this.rpc("commit_discovery", {
      p_story: story,
      p_expected_version: expectedVersion,
      p_record: record,
      p_owner: owner,
    });
  }
}
export async function ingestionStore() {
  return new DatabaseIngestionStore(await applicationRpc());
}
