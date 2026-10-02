import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { initializeDb } from "../src/server/local-db";
import { localRpc, type Rpc } from "../src/ingestion/store";
import { syncSubscribers } from "../src/providers/subscribers";

vi.mock("../src/providers/auth", () => ({
  providerToken: async () => ({
    access_token: "fixture-not-real",
    expires_at: 8640000000000000,
    scopes: [],
  }),
}));

let db: PGlite;
let rpc: Rpc;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
beforeAll(async () => {
  db = await initializeDb();
  rpc = localRpc(db);
  await db.query(
    "insert into control_entities(id,kind,version,is_demo,data) values(gen_random_uuid(),'account',1,false,$1)",
    [
      JSON.stringify({
        platform: "beehiiv",
        status: "connected",
        external_id: "fixture-publication",
      }),
    ],
  );
});
beforeEach(async () => {
  vi.stubEnv("BRAINOS_SUBSCRIBER_SYNC", "enabled");
  await db.exec("delete from subscriber_intake");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => db.close());

async function subscriber(overrides: Record<string, unknown> = {}) {
  const row = {
    email: "consenting@example.invalid",
    status: "active",
    consent_at: "2026-01-01T00:00:00Z",
    source: "public-site",
    privacy_version: "fixture",
    unsubscribe_hash: "a".repeat(64),
    sync_status: "pending",
    sync_attempts: 0,
    ...overrides,
  };
  const keys = Object.keys(row);
  const result = await db.query<{ id: string }>(
    `insert into subscriber_intake(${keys.join(",")}) values(${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    Object.values(row),
  );
  return result.rows[0].id;
}

it("prioritizes subscriber 101 and rotates successful checks beyond the first 100", async () => {
  await db.exec(`
    insert into subscriber_intake(email,status,consent_at,source,privacy_version,unsubscribe_hash,beehiiv_id,sync_status,synced_at)
    select 'known-'||n||'@example.invalid','active',now(),'public-site','fixture',repeat('b',64),'remote-'||n,'synced','2026-01-01'::timestamptz
    from generate_series(1,100) n;
  `);
  await subscriber();
  const calls: {
    method: string;
    url: string;
    body: Record<string, unknown>;
  }[] = [];
  const send = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ method, url, body });
    return json({
      data: method === "GET" ? { status: "active" } : { id: "remote-101" },
    });
  });
  await syncSubscribers(rpc, send);
  expect(calls).toHaveLength(100);
  expect(calls[0]).toMatchObject({
    method: "POST",
    body: {
      email: "consenting@example.invalid",
      reactivate_existing: false,
      send_welcome_email: false,
    },
  });
  await syncSubscribers(rpc, send);
  const result = await db.query<{ checked: number }>(
    "select count(*)::int checked from subscriber_intake where checked_at is not null",
  );
  expect(result.rows[0].checked).toBe(101);
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  expect(calls).toHaveLength(200);
});

it("resets successful attempts and gives a fresh unsubscribe its own retry budget", async () => {
  const id = await subscriber({ sync_attempts: 2 });
  const send = vi.fn(async (_url: string, init?: RequestInit) =>
    json({
      data:
        init?.method === "GET" ? { status: "active" } : { id: "remote-optout" },
    }),
  );
  await syncSubscribers(rpc, send);
  let result = await db.query<{
    sync_attempts: number;
    status: string;
    sync_status: string;
  }>(
    "select sync_attempts,status,sync_status from subscriber_intake where id=$1",
    [id],
  );
  expect(result.rows[0].sync_attempts).toBe(0);
  await db.query(
    "update subscriber_intake set sync_attempts=3,sync_status='RATE_LIMIT' where id=$1",
    [id],
  );
  await rpc("unsubscribe_subscriber", { p_hash: "a".repeat(64) });
  result = await db.query(
    "select sync_attempts,status,sync_status from subscriber_intake where id=$1",
    [id],
  );
  expect(result.rows[0]).toEqual({
    sync_attempts: 0,
    status: "unsubscribed",
    sync_status: "pending",
  });
  await syncSubscribers(rpc, send);
  expect(send.mock.calls.at(-1)?.[1]).toMatchObject({
    method: "PATCH",
    body: JSON.stringify({ unsubscribe: true }),
  });
  const calls = send.mock.calls.length;
  await syncSubscribers(rpc, send);
  expect(send).toHaveBeenCalledTimes(calls);
});

it("propagates remote opt-outs locally without reactivation or repeated writes", async () => {
  const id = await subscriber({
    beehiiv_id: "remote-unsubscribed",
    sync_status: "synced",
  });
  const send = vi.fn(async () => json({ data: { status: "unsubscribed" } }));
  await syncSubscribers(rpc, send);
  const result = await db.query<{
    status: string;
    sync_attempts: number;
    checked_at: string;
  }>(
    "select status,sync_attempts,checked_at from subscriber_intake where id=$1",
    [id],
  );
  expect(result.rows[0]).toMatchObject({
    status: "unsubscribed",
    sync_attempts: 0,
  });
  expect(result.rows[0].checked_at).toBeTruthy();
  await syncSubscribers(rpc, send);
  expect(send).toHaveBeenCalledTimes(1);
});

it("does not mark a subscription synced when its provider identifier is missing", async () => {
  const id = await subscriber();
  await syncSubscribers(rpc, async () => json({ data: {} }));
  const result = await db.query<{ sync_status: string; sync_attempts: number }>(
    "select sync_status,sync_attempts from subscriber_intake where id=$1",
    [id],
  );
  expect(result.rows[0]).toEqual({
    sync_status: "SUBSCRIBER_ID_MISSING",
    sync_attempts: 1,
  });
});

it("keeps a new local opt-out pending when an earlier subscribe finishes", async () => {
  const id = await subscriber();
  const send = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST")
      await rpc("unsubscribe_subscriber", { p_hash: "a".repeat(64) });
    return json({
      data:
        init?.method === "GET" ? { status: "active" } : { id: "remote-race" },
    });
  });
  await syncSubscribers(rpc, send);
  const result = await db.query<{
    status: string;
    sync_status: string;
    sync_attempts: number;
  }>(
    "select status,sync_status,sync_attempts from subscriber_intake where id=$1",
    [id],
  );
  expect(result.rows[0]).toEqual({
    status: "unsubscribed",
    sync_status: "pending",
    sync_attempts: 0,
  });
  await syncSubscribers(rpc, send);
  expect(send.mock.calls.at(-1)?.[1]).toMatchObject({
    method: "PATCH",
    body: JSON.stringify({ unsubscribe: true }),
  });
});

it("does not contact the provider while sync is disabled", async () => {
  vi.stubEnv("BRAINOS_SUBSCRIBER_SYNC", "disabled");
  const send = vi.fn();
  expect(await syncSubscribers(rpc, send)).toEqual({
    state: "DISABLED",
    processed: 0,
  });
  expect(send).not.toHaveBeenCalled();
});
