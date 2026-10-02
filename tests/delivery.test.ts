import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createHash } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { deliveryResponse } from "../src/providers/delivery-runtime";
import { initializeDb, seedDb } from "../src/server/local-db";
import { localRpc, type Rpc } from "../src/ingestion/store";
import {
  controlAction,
  controlSnapshot,
  readControl,
} from "../src/control/service";
import { enqueueOutbox } from "../src/providers/outbox";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const config = {
  url: "https://fixture.supabase.co",
  key: "fixture-service-secret-NOT-REAL",
};
const secret = "a".repeat(43),
  deliveryId = "00000000-0000-4000-8000-000000000001";
const url = `https://fixture.supabase.co/functions/v1/brainos-media/${deliveryId}/${secret}/asset.png`;
const file = {
  bucket: "brainos-production",
  file_id: "graphics/fixture/content-addressed.png",
  mime: "image/png",
  bytes: 5,
  sha256: sha("image"),
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("approved media delivery runtime", () => {
  it("serves authenticated storage bytes after resolving the hashed capability, without exposing credentials", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(json(file))
      .mockResolvedValueOnce(
        new Response("image", {
          headers: {
            "Content-Length": "5",
            "Set-Cookie": "do-not-forward",
            "x-storage-secret": "do-not-forward",
          },
        }),
      )
      .mockResolvedValueOnce(json(file));
    const response = await deliveryResponse(new Request(url), config, send);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("image");
    expect(send).toHaveBeenCalledTimes(3);
    const [resolveUrl, resolveRequest] = send.mock.calls[0];
    expect(resolveUrl).toBe(config.url + "/rest/v1/rpc/resolve_media_delivery");
    expect(JSON.parse(resolveRequest.body)).toEqual({
      p_id: deliveryId,
      p_hash: sha(secret),
    });
    expect(resolveRequest.body).not.toContain(secret);
    expect(send.mock.calls[1][1].headers.Authorization).toBe(
      `Bearer ${config.key}`,
    );
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-storage-secret")).toBeNull();
    expect(JSON.stringify([...response.headers])).not.toContain(config.key);
  });
  it("supports HEAD without returning bytes", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(json(file))
      .mockResolvedValueOnce(new Response("image"))
      .mockResolvedValueOnce(json(file));
    const response = await deliveryResponse(
      new Request(url, { method: "HEAD" }),
      config,
      send,
    );
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(response.headers.get("content-length")).toBe("5");
    expect(send.mock.calls[1][1].method).toBe("GET");
  });
  it("serves a range only after validating the complete object and rechecking approval", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(json(file))
      .mockResolvedValueOnce(new Response("image"))
      .mockResolvedValueOnce(json(file));
    const response = await deliveryResponse(
      new Request(url, { headers: { range: "bytes=0-2" } }),
      config,
      send,
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-2/5");
    expect(send.mock.calls[1][1].headers.Range).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(3);
    expect(await response.text()).toBe("ima");
  });
  it.each(["POST", "PUT", "DELETE", "OPTIONS"])(
    "rejects %s without HTTP",
    async (method) => {
      const send = vi.fn();
      expect(
        (await deliveryResponse(new Request(url, { method }), config, send))
          .status,
      ).toBe(405);
      expect(send).not.toHaveBeenCalled();
    },
  );
  it("rejects malformed capabilities and denies unresolved capabilities before reading storage", async () => {
    const send = vi.fn();
    expect(
      (
        await deliveryResponse(
          new Request(url.replace(secret, "short")),
          config,
          send,
        )
      ).status,
    ).toBe(404);
    expect(send).not.toHaveBeenCalled();
    send.mockResolvedValueOnce(json(null));
    expect(
      (await deliveryResponse(new Request(url), config, send)).status,
    ).toBe(404);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...file, bucket: "public-assets" },
    { ...file, file_id: "../other-project/private.png" },
    { ...file, mime: "text/html" },
    { ...file, bytes: 50000001 },
    { ...file, bytes: 0 },
  ])("rejects invalid resolved media before fetching bytes", async (record) => {
    const send = vi.fn().mockResolvedValueOnce(json(record));
    expect(
      (await deliveryResponse(new Request(url), config, send)).status,
    ).toBe(404);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each(["bytes=0-1,3-4", "bytes=-"])(
    "rejects malformed range %s without a storage read",
    async (range) => {
      const send = vi.fn().mockResolvedValueOnce(json(file));
      expect(
        (
          await deliveryResponse(
            new Request(url, { headers: { range } }),
            config,
            send,
          )
        ).status,
      ).toBe(416);
      expect(send).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["bytes=10-1", "bytes=10-", "bytes=-0", "bytes=9007199254740992-"])(
    "rejects unsatisfiable range %s",
    async (range) => {
      const send = vi
        .fn()
        .mockResolvedValueOnce(json(file))
        .mockResolvedValueOnce(new Response("image"))
        .mockResolvedValueOnce(json(file));
      expect(
        (
          await deliveryResponse(
            new Request(url, { headers: { range } }),
            config,
            send,
          )
        ).status,
      ).toBe(416);
    },
  );
  it.each([
    ["bytes=2-", "age", "bytes 2-4/5"],
    ["bytes=-2", "ge", "bytes 3-4/5"],
    ["bytes=0-20", "image", "bytes 0-4/5"],
  ])("supports bounded range %s", async (range, body, contentRange) => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(json(file))
      .mockResolvedValueOnce(new Response("image"))
      .mockResolvedValueOnce(json(file));
    const response = await deliveryResponse(
      new Request(url, { headers: { range } }),
      config,
      send,
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(contentRange);
    expect(await response.text()).toBe(body);
  });
  it.each(["tamper", "imag", "image plus unapproved bytes"])(
    "never exposes altered or incorrectly sized storage bytes: %s",
    async (bytes) => {
      const send = vi
        .fn()
        .mockResolvedValueOnce(json(file))
        .mockResolvedValueOnce(new Response(bytes));
      const response = await deliveryResponse(new Request(url), config, send);
      expect(response.status).toBe(503);
      expect(await response.text()).toBe("");
    },
  );
  it("rechecks approval after reading bytes and blocks a concurrent revocation", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(json(file))
      .mockResolvedValueOnce(new Response("image"))
      .mockResolvedValueOnce(json(null));
    const response = await deliveryResponse(new Request(url), config, send);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });
  it("fails closed on resolver/storage failures without leaking upstream error text", async () => {
    for (const send of [
      vi.fn().mockResolvedValueOnce(json({ error: "SECRET" }, 500)),
      vi
        .fn()
        .mockResolvedValueOnce(json(file))
        .mockRejectedValueOnce(Error("SECRET")),
      vi
        .fn()
        .mockResolvedValueOnce(json(file))
        .mockResolvedValueOnce(json({ error: "SECRET" }, 403)),
    ]) {
      const response = await deliveryResponse(new Request(url), config, send);
      expect(response.status).toBe(503);
      expect(await response.text()).toBe("");
    }
  });
});

describe("approved media delivery database gates", () => {
  let db: PGlite,
    rpc: Rpc,
    contentId: string,
    packageId: string,
    graphicId: string,
    accountId: string,
    outboxId: string,
    delivery: Record<string, unknown>;
  const run = (command: unknown) =>
    controlAction(rpc, command, "human delivery fixture", false);
  const resolve = () =>
    rpc("resolve_media_delivery", {
      p_id: delivery.id,
      p_hash: delivery.secret_hash,
    });
  beforeAll(async () => {
    db = await initializeDb();
    await seedDb(db);
    rpc = localRpc(db);
    const demo = await controlSnapshot(rpc, true),
      story = demo.stories.find((s) => s.status === "approved")!;
    await db.query("update stories set is_demo=false where id=$1", [story.id]);
    const brand = await run({
      action: "brand_save",
      name: "Delivery fixture",
      positioning: "Source-based research",
      audience: "Operators",
      pillars: ["AI at work"],
      tone: ["Specific"],
      cta: "Inspect the evidence",
    });
    await run({ action: "brand_approve", id: brand.id, confirmed: true });
    const idea = await run({
      action: "idea_create",
      title: "Delivery fixture",
      source: "story",
      story_id: story.id,
      provenance: "Fictional delivery test; no external publication",
    });
    await run({ action: "idea_transition", id: idea.id, target: "qualified" });
    await run({ action: "idea_transition", id: idea.id, target: "selected" });
    const content = await run({
      action: "content_create",
      idea_id: idea.id,
      platform: "instagram",
      format: "carousel",
      purpose: "Test approval-gated media access",
    });
    contentId = content.id!;
    await run({
      action: "content_bind",
      id: contentId,
      draft_id: story.active_draft_id,
    });
    await run({
      action: "content_freshness",
      id: contentId,
      evergreen: true,
      fresh_until: null,
      confirmed: true,
    });
    await run({
      action: "content_transition",
      id: contentId,
      target: "review",
      confirmed: true,
    });
    await run({
      action: "content_transition",
      id: contentId,
      target: "approved",
      confirmed: true,
    });
    graphicId = crypto.randomUUID();
    const draft = story.drafts.find((d) => d.id === story.active_draft_id)!,
      png = {
        file_id: `graphics/${graphicId}/${sha("svg")}.png`,
        sha256: sha("image"),
        source_svg_sha256: sha("svg"),
        width: 1080,
        height: 1350,
        bytes: 5,
        mime: "image/png",
      };
    await rpc("commit_control", {
      p_epoch: (await readControl(rpc, false)).epoch,
      p_entities: [
        {
          id: graphicId,
          kind: "graphic",
          version: 1,
          parent_id: contentId,
          story_id: story.id,
          draft_id: draft.id,
          is_demo: false,
          data: {
            status: "rendered",
            template: "carousel",
            template_version: 1,
            content_revision: draft.revision,
            sha256: sha("graphic"),
            rights: "cleared",
            publishable: true,
            scope: "instagram",
            cleared_by: "human delivery fixture",
            outputs: [{ slide: 0, sha256: sha("svg"), png }],
          },
        },
      ],
      p_jobs: [],
      p_public: [],
      p_actor: "human delivery fixture",
    });
    const pkg = await run({
      action: "package_create",
      id: contentId,
      title: "Delivery fixture",
      caption: "Fixture: inspect the evidence.",
      cta: "Inspect",
      thread: [],
      graphic_ids: [graphicId],
    });
    packageId = pkg.id!;
    await run({ action: "package_approve", id: packageId, confirmed: true });
    await run({
      action: "content_final",
      id: contentId,
      package_id: packageId,
      confirmed: true,
    });
    accountId = crypto.randomUUID();
    await rpc("commit_control", {
      p_epoch: (await readControl(rpc, false)).epoch,
      p_entities: [
        {
          id: accountId,
          kind: "account",
          version: 1,
          parent_id: null,
          story_id: null,
          draft_id: null,
          is_demo: false,
          data: {
            platform: "instagram",
            status: "connected",
            external_id: "fixture-account",
            capabilities: ["publish"],
            handle: "fixture",
            verified_at: new Date().toISOString(),
            reason: null,
          },
        },
      ],
      p_jobs: [],
      p_public: [],
      p_actor: "human delivery fixture",
    });
    outboxId = (await enqueueOutbox(
      rpc,
      packageId,
      new Date().toISOString(),
      false,
    )) as string;
    delivery = {
      id: crypto.randomUUID(),
      outbox_id: outboxId,
      secret_hash: sha(secret),
      asset_key: "graphic:0:0:png",
      bucket: "brainos-production",
      file_id: png.file_id,
      mime: png.mime,
      bytes: png.bytes,
      sha256: png.sha256,
      graphic_id: graphicId,
      graphic_version: 1,
    };
    await rpc("register_media_delivery", { p_record: delivery });
  }, 30000);
  beforeEach(async () => {
    await db.exec("begin");
  });
  afterEach(async () => {
    await db.exec("rollback");
  });
  afterAll(async () => {
    await db?.close();
  });
  it("resolves the exact approved media capability and never accepts another secret", async () => {
    expect(await resolve()).toMatchObject({
      file_id: delivery.file_id,
      sha256: delivery.sha256,
    });
    expect(
      await rpc("resolve_media_delivery", {
        p_id: delivery.id,
        p_hash: sha("wrong secret"),
      }),
    ).toBeNull();
  });
  it.each([
    "final approval",
    "package version",
    "graphic version",
    "graphic rights",
    "graphic publishability",
    "capability",
    "account revocation",
    "account identity",
    "freshness",
    "revalidation",
    "package fingerprint",
    "content approval",
    "delivery revocation",
    "outbox cancellation",
    "required script asset rights",
    "active brand revision",
    "source evidence",
  ])("denies media after %s changes", async (change) => {
    const entityChange = async (id: string, key: string, value: unknown) =>
      db.query(
        "update control_entities set data=jsonb_set(data,ARRAY[$2],$3::jsonb) where id=$1",
        [id, key, JSON.stringify(value)],
      );
    if (change === "final approval")
      await entityChange(contentId, "final_approval", null);
    if (change === "package version")
      await db.query(
        "update control_entities set version=version+1 where id=$1",
        [packageId],
      );
    if (change === "graphic version")
      await db.query(
        "update control_entities set version=version+1 where id=$1",
        [graphicId],
      );
    if (change === "graphic rights")
      await entityChange(graphicId, "rights", "blocked");
    if (change === "graphic publishability")
      await entityChange(graphicId, "publishable", false);
    if (change === "capability")
      await entityChange(accountId, "capabilities", []);
    if (change === "account revocation")
      await entityChange(accountId, "status", "revoked");
    if (change === "account identity")
      await entityChange(accountId, "external_id", "other-account");
    if (change === "freshness") {
      await entityChange(contentId, "evergreen", false);
      await entityChange(contentId, "fresh_until", "2000-01-01T00:00:00Z");
    }
    if (change === "revalidation")
      await entityChange(contentId, "revalidation_required", true);
    if (change === "package fingerprint")
      await entityChange(packageId, "fingerprint", sha("other package"));
    if (change === "content approval")
      await entityChange(contentId, "content_state", "drafting");
    if (change === "delivery revocation")
      await db.query(
        "update provider_media_deliveries set revoked_at=now() where id=$1",
        [delivery.id],
      );
    if (change === "outbox cancellation")
      await db.query(
        "update provider_outbox set status='cancelled' where id=$1",
        [outboxId],
      );
    if (change === "required script asset rights")
      await db.query(
        "update assets set rights_status='blocked',publishable=false where story_id=(select story_id from control_entities where id=$1)",
        [contentId],
      );
    if (change === "active brand revision")
      await db.exec(
        "update control_entities set version=version+1 where kind='brand' and data->>'status'='active'",
      );
    if (change === "source evidence")
      await db.query(
        "update sources set publisher='Updated publisher' where story_id=(select story_id from control_entities where id=$1)",
        [contentId],
      );
    expect(await resolve()).toBeNull();
  });
  it("cannot rebase a new delivery onto revoked required script asset rights", async () => {
    await db.query(
      "update assets set rights_status='blocked',publishable=false where story_id=(select story_id from control_entities where id=$1)",
      [contentId],
    );
    expect(await resolve()).toBeNull();
    await expect(
      rpc("register_media_delivery", {
        p_record: { ...delivery, id: crypto.randomUUID() },
      }),
    ).rejects.toThrow();
  });
  it("does not register an unrelated private object under an approved outbox", async () => {
    await expect(
      rpc("register_media_delivery", {
        p_record: {
          ...delivery,
          id: crypto.randomUUID(),
          file_id: "other-project/private-recording.mp4",
          sha256: sha("unapproved bytes"),
        },
      }),
    ).rejects.toThrow("Exact approved media delivery");
  });
  it("withholds RPC access and table reads from public and signed-in browser roles", async () => {
    for (const role of ["anon", "authenticated"]) {
      const result = await db.query<{ execute: boolean; select: boolean }>(
        "select has_function_privilege($1,'public.resolve_media_delivery(uuid,text)','execute') as execute,has_table_privilege($1,'public.provider_media_deliveries','select') as select",
        [role],
      );
      expect(result.rows[0]).toEqual({ execute: false, select: false });
    }
  });
});
