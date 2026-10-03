import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { initializeDb } from "../src/server/local-db";
import { localRpc, type Rpc } from "../src/ingestion/store";
import { controlAction, readControl } from "../src/control/service";
import { openSecret, sealSecret } from "../src/integrations/google-oauth";
import {
  disconnectProvider,
  installBuffer,
  providerToken,
  selectProviderAccount,
} from "../src/providers/auth";
import {
  OfficialClient,
  type TokenSet,
  type Transport,
} from "../src/providers/client";
import { bufferApi } from "../src/providers/buffer-client";
import { activationState } from "../src/providers/activation";
import { providerHealth } from "../src/providers/health";

// Real local persistence and auth orchestration, official GraphQL read fixtures.
// No social accounts, Buffer credentials, API writes or external requests are used.
let db: PGlite;
let rpc: Rpc;
let unexpectedFetch: ReturnType<typeof vi.fn<Transport>>;
const fixtureKey = "buffer-installation-fixture-NOT-A-REAL-KEY";
const actor = "activation-contract-fixture";
const channel = (service: string, id = `buffer-${service}-fixture`) => ({
  id,
  service,
  serviceId: `social-${id}`,
  organizationId: "buffer-org-fixture",
  name: `${service}_fixture`,
  displayName: `Fixture ${service}`,
  type: "business",
  isDisconnected: false,
  isLocked: false,
  isQueuePaused: false,
  hasActiveMemberDevice: false,
  allowedActions: ["scheduleUpdates"],
  scopes: service === "instagram" ? ["instagram_business_content_publish"] : [],
});
const allChannels = () => [
  channel("instagram"),
  channel("tiktok"),
  channel("twitter"),
];
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const discovery = (channels = allChannels()) =>
  vi.fn<Transport>(async (url, init) => {
    expect(url).toBe(bufferApi);
    expect(init?.headers).toMatchObject({
      Authorization: `Bearer ${fixtureKey}`,
    });
    const body = JSON.parse(String(init?.body)) as { query: string };
    expect(body.query.trim()).toMatch(/^query /);
    if (body.query.includes("BufferOrganizations"))
      return json({
        data: { account: { organizations: [{ id: "buffer-org-fixture" }] } },
      });
    if (body.query.includes("BufferChannels"))
      return json({ data: { channels } });
    throw Error("Unexpected discovery contract query");
  });
const accounts = async () =>
  (await readControl(rpc, false)).entities.filter((e) => e.kind === "account");

beforeEach(async () => {
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "a".repeat(64));
  vi.stubEnv("BRAINOS_EXTERNAL_PUBLISHING", "disabled");
  vi.stubEnv("BRAINOS_ALLOW_PAID_X", "false");
  db = await initializeDb();
  rpc = localRpc(db);
  unexpectedFetch = vi.fn<Transport>(async () => {
    throw Error("Uninjected HTTP is forbidden in activation fixtures");
  });
  vi.stubGlobal("fetch", unexpectedFetch);
}, 30000);

afterEach(async () => {
  await db.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  expect(unexpectedFetch).not.toHaveBeenCalled();
});

it("installs one private key, automatically binds each unique social channel, and exposes no plaintext credential", async () => {
  const send = discovery();
  expect(await installBuffer(rpc, fixtureKey, actor, send)).toEqual({
    channels: ["instagram", "tiktok", "x"],
    selection_required: false,
  });
  const activation = await activationState(rpc, false);
  expect(
    activation.providers
      .filter((p) => p.account?.data.status === "connected")
      .every((p) => p.engineering === "CONNECTED"),
  ).toBe(true);
  const connected = await accounts();
  expect(connected).toHaveLength(3);
  for (const account of connected) {
    const service =
      account.data.platform === "x" ? "twitter" : account.data.platform;
    expect(account.data).toMatchObject({
      status: "connected",
      delivery_transport: "buffer",
      external_id: `buffer-${service}-fixture`,
      choices: [],
      capabilities: ["profile_read", "publish", "media_upload", "schedule"],
    });
    expect(Date.parse(String(account.data.verified_at))).toBeGreaterThan(
      Date.now() - 60000,
    );
    expect(await providerToken(rpc, account.id, send)).toMatchObject({
      access_token: fixtureKey,
      transport: "buffer",
      account_id: account.data.external_id,
    });
    const ciphertext = (await rpc("provider_secret", {
      p_id: account.id,
    })) as string;
    expect(ciphertext).not.toContain(fixtureKey);
    expect(
      JSON.parse(openSecret(ciphertext, `provider:${account.id}`)),
    ).toMatchObject({ access_token: fixtureKey });
    expect(() => openSecret(ciphertext, "provider:another-account")).toThrow();
  }
  const visible = JSON.stringify(await readControl(rpc, false));
  expect(visible).not.toContain(fixtureKey);
  expect(visible).not.toMatch(/access_token|refresh_token|ciphertext/);
  const credentials = await db.query<{ ciphertext: string }>(
    "select ciphertext from provider_credentials",
  );
  expect(credentials.rows).toHaveLength(3);
  expect(JSON.stringify(credentials.rows)).not.toContain(fixtureKey);
  expect(new Set(credentials.rows.map((r) => r.ciphertext)).size).toBe(3);
  expect(send).toHaveBeenCalled();
});

it("reinstalling the same key and channels preserves the existing account identities", async () => {
  const send = discovery();
  await installBuffer(rpc, fixtureKey, actor, send);
  const before = await accounts();
  await installBuffer(rpc, fixtureKey, actor, send);
  const after = await accounts();
  expect(after.map((a) => a.id).sort()).toEqual(before.map((a) => a.id).sort());
  expect(after.every((a) => a.data.status === "connected")).toBe(true);
  expect(
    (await db.query("select account_id from provider_credentials")).rows,
  ).toHaveLength(3);
});

it("requires a choice when two Buffer channels share a platform and binds only the selected identity", async () => {
  const send = discovery([
    channel("instagram", "ig-first"),
    channel("instagram", "ig-second"),
  ]);
  expect(await installBuffer(rpc, fixtureKey, actor, send)).toEqual({
    channels: ["instagram"],
    selection_required: true,
  });
  const [pending] = await accounts();
  expect(pending.data.status).toBe("auth_required");
  expect(pending.data.external_id).toBeFalsy();
  expect(pending.data.choices).toHaveLength(2);
  expect(
    (await providerToken(rpc, pending.id, send)).account_id,
  ).toBeUndefined();
  await expect(
    selectProviderAccount(rpc, pending.id, "not-authorized", actor, send),
  ).rejects.toMatchObject({ code: "ACCOUNT_MISMATCH" });
  await selectProviderAccount(rpc, pending.id, "ig-second", actor, send);
  expect((await accounts())[0].data).toMatchObject({
    status: "connected",
    external_id: "ig-second",
    choices: [],
  });
  expect((await providerToken(rpc, pending.id, send)).account_id).toBe(
    "ig-second",
  );
});

it("preflights every platform and refuses to overwrite an existing native connection", async () => {
  await controlAction(
    rpc,
    { action: "account_create", platform: "x", handle: "native_fixture" },
    actor,
    false,
  );
  const state = await readControl(rpc, false);
  const native = state.entities.find((e) => e.kind === "account")!;
  const nativeToken: TokenSet = {
    access_token: "native-fixture-NOT-A-REAL-TOKEN",
    expires_at: Date.now() + 30 * 86400000,
    scopes: [],
    account_id: "native-social-fixture",
  };
  await rpc("install_provider_connection", {
    p_epoch: state.epoch,
    p_entity: {
      ...native,
      version: native.version + 1,
      data: {
        ...native.data,
        status: "connected",
        delivery_transport: "native",
        external_id: "native-social-fixture",
      },
    },
    p_ciphertext: sealSecret(
      JSON.stringify(nativeToken),
      `provider:${native.id}`,
    ),
    p_actor: actor,
  });
  const before = await readControl(rpc, false);
  const ciphertext = await rpc("provider_secret", { p_id: native.id });
  await expect(
    installBuffer(rpc, fixtureKey, actor, discovery()),
  ).rejects.toMatchObject({ code: "DISCONNECT_NATIVE_ACCOUNT_BEFORE_BUFFER" });
  expect(await readControl(rpc, false)).toEqual(before);
  expect(await rpc("provider_secret", { p_id: native.id })).toBe(ciphertext);
  expect(await accounts()).toHaveLength(1);
});

it("returns an actionable empty-channel error without installing an account or secret", async () => {
  await expect(
    installBuffer(rpc, fixtureKey, actor, discovery([channel("youtube")])),
  ).rejects.toMatchObject({ code: "BUFFER_CONNECT_SOCIAL_CHANNELS_FIRST" });
  expect(await accounts()).toHaveLength(0);
  expect(
    (await db.query("select account_id from provider_credentials")).rows,
  ).toHaveLength(0);
});

it("removes only the selected local Buffer credential and never invokes native token revocation", async () => {
  await installBuffer(rpc, fixtureKey, actor, discovery());
  const before = await accounts();
  const selected = before.find((a) => a.data.platform === "instagram")!;
  const others = before.filter((a) => a.id !== selected.id);
  const ciphertexts = new Map(
    await Promise.all(
      others.map(
        async (a) =>
          [a.id, await rpc("provider_secret", { p_id: a.id })] as const,
      ),
    ),
  );
  const revoke = vi.spyOn(OfficialClient.prototype, "revoke");
  await disconnectProvider(rpc, selected.id, actor);
  expect(revoke).not.toHaveBeenCalled();
  expect(await rpc("provider_secret", { p_id: selected.id })).toBeNull();
  await expect(providerToken(rpc, selected.id)).rejects.toMatchObject({
    code: "AUTH_REQUIRED",
  });
  const after = await accounts();
  expect(after.find((a) => a.id === selected.id)?.data).toMatchObject({
    status: "revoked",
    capabilities: [],
    external_id: null,
  });
  expect(
    String(after.find((a) => a.id === selected.id)?.data.reason),
  ).toContain("other connected channels may use it");
  for (const other of others) {
    expect(after.find((a) => a.id === other.id)).toEqual(other);
    expect(await rpc("provider_secret", { p_id: other.id })).toBe(
      ciphertexts.get(other.id),
    );
    expect((await providerToken(rpc, other.id)).access_token).toBe(fixtureKey);
  }
});

it("skips all Buffer network checks for six hours after verification", async () => {
  await installBuffer(rpc, fixtureKey, actor, discovery());
  const state = await readControl(rpc, false);
  await rpc("commit_control", {
    p_epoch: state.epoch,
    p_entities: state.entities
      .filter((e) => e.kind === "account")
      .map((e, i) => ({
        ...e,
        version: e.version + 1,
        data: {
          ...e.data,
          verified_at: new Date(
            Date.now() - (i === 0 ? 0 : 5 * 3600000 + 59 * 60000),
          ).toISOString(),
        },
      })),
    p_jobs: [],
    p_public: [],
    p_actor: actor,
  });
  const before = await readControl(rpc, false);
  const result = await providerHealth(rpc);
  expect(result).toHaveLength(3);
  expect(result.map((r) => r.provider).sort()).toEqual([
    "instagram",
    "tiktok",
    "x",
  ]);
  expect(
    result.every(
      (r) => r.state === "connected" && r.next_check === "six_hour_interval",
    ),
  ).toBe(true);
  expect(await readControl(rpc, false)).toEqual(before);
  expect(unexpectedFetch).not.toHaveBeenCalled();
});

it("connecting never authorizes sending; an editor can explicitly authorize and revoke without HTTP", async () => {
  const { activationAction } = await import("../src/providers/activation");
  const { externalWritesAllowed } =
    await import("../src/providers/publishing-policy");
  vi.stubEnv("BRAINOS_EXTERNAL_PUBLISHING", "approval_required");
  await installBuffer(rpc, fixtureKey, actor, discovery());
  let account = (await accounts())[0];
  expect(externalWritesAllowed(account.data)).toBe(false);
  await activationAction(
    rpc,
    {
      action: "distribution_authorize",
      id: account.id,
      enabled: true,
      confirmed: true,
    },
    actor,
    false,
  );
  account = (await accounts()).find((a) => a.id === account.id)!;
  expect(externalWritesAllowed(account.data)).toBe(true);
  await activationAction(
    rpc,
    {
      action: "distribution_authorize",
      id: account.id,
      enabled: false,
      confirmed: true,
    },
    actor,
    false,
  );
  account = (await accounts()).find((a) => a.id === account.id)!;
  expect(externalWritesAllowed(account.data)).toBe(false);
  expect(unexpectedFetch).not.toHaveBeenCalled();
});
it("reconnecting resets prior delivery authorization", async () => {
  const { activationAction } = await import("../src/providers/activation");
  await installBuffer(rpc, fixtureKey, actor, discovery());
  const account = (await accounts())[0];
  await activationAction(
    rpc,
    {
      action: "distribution_authorize",
      id: account.id,
      enabled: true,
      confirmed: true,
    },
    actor,
    false,
  );
  await installBuffer(rpc, fixtureKey, actor, discovery());
  expect(
    (await accounts()).find((a) => a.id === account.id)!.data.writes_authorized,
  ).toBe(false);
});
