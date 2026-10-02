import {
  personalDriveRoot,
  personalDriveEmail,
  fingerprint,
} from "./drive-fixture";
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
import type { PGlite } from "@electric-sql/pglite";
import { initializeDb } from "../src/server/local-db";
import { localRpc, type Rpc } from "../src/ingestion/store";
import {
  createConsent,
  validateConsent,
  openSecret,
  sealSecret,
  googleDriveScope,
} from "../src/integrations/google-oauth";
let db: PGlite, rpc: Rpc;
beforeAll(async () => {
  db = await initializeDb();
  rpc = localRpc(db);
});
afterAll(async () => db.close());
beforeEach(() => {
  vi.stubEnv("GOOGLE_DRIVE_ROOT_FINGERPRINT", fingerprint(personalDriveRoot));
  vi.stubEnv(
    "GOOGLE_DRIVE_ACCOUNT_FINGERPRINT",
    fingerprint(personalDriveEmail.toLowerCase()),
  );
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "a".repeat(64));
  vi.stubEnv("CONTENT_OS_MODE", "supabase");
  vi.stubEnv("CONTENT_OS_ORIGIN", "https://newsroom.example");
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret");
  vi.stubEnv("GOOGLE_DRIVE_ROOT_ID", personalDriveRoot);
  vi.stubEnv("GOOGLE_DRIVE_ACCOUNT_EMAIL", personalDriveEmail);
});
afterEach(() => vi.unstubAllEnvs());
describe("Google runtime OAuth", () => {
  it("encrypts refresh credentials with authenticated encryption and distinct state/refresh contexts", () => {
    const sealed = sealSecret("test-refresh-token", "refresh");
    expect(sealed).not.toContain("test-refresh-token");
    expect(openSecret(sealed, "refresh")).toBe("test-refresh-token");
    expect(() => openSecret(sealed, "state")).toThrow();
    const pieces = sealed.split(".");
    pieces[3] = Buffer.from("tampered").toString("base64url");
    expect(() => openSecret(pieces.join("."), "refresh")).toThrow();
    vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "b".repeat(64));
    expect(() => openSecret(sealed, "refresh")).toThrow();
  });
  it("binds the consent callback to the editor, unpredictable state, expiry and PKCE", () => {
    const { cookie, url } = createConsent("editor-id", 1000),
      params = new URL(url).searchParams;
    expect(params.get("redirect_uri")).toBe(
      "https://newsroom.example/api/integrations/google/callback",
    );
    expect(params.get("scope")).toBe(googleDriveScope);
    expect(params.get("scope")).not.toContain("gmail");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(
      validateConsent(cookie, params.get("state")!, "editor-id", 2000),
    ).toHaveLength(43);
    expect(() =>
      validateConsent(cookie, "wrong-state", "editor-id", 2000),
    ).toThrow();
    expect(() =>
      validateConsent(cookie, params.get("state")!, "another-editor", 2000),
    ).toThrow();
    expect(() =>
      validateConsent(cookie, params.get("state")!, "editor-id", 601000),
    ).toThrow();
  });
  it("refuses incomplete runtime or unsafe redirect-origin configuration", () => {
    vi.stubEnv("CONTENT_OS_ORIGIN", "http://newsroom.example");
    expect(() => createConsent("editor")).toThrow("HTTPS");
    vi.stubEnv("CONTENT_OS_ORIGIN", "https://newsroom.example/redirect");
    expect(() => createConsent("editor")).toThrow("exact");
    vi.stubEnv("CONTENT_OS_ORIGIN", "https://newsroom.example");
    vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "");
    expect(() => createConsent("editor")).toThrow("encryption");
  });
  it("persists only encrypted credentials and denies direct browser-role reads", async () => {
    const encrypted = sealSecret("test-offline-secret", "refresh");
    await rpc("save_google_connection", {
      p_ciphertext: encrypted,
      p_scopes: [googleDriveScope],
      p_actor: "editor-id",
    });
    const read = (await rpc("read_google_connection")) as {
      encrypted_refresh_token: string;
      authorized_by: string;
    };
    expect(read.authorized_by).toBe("editor-id");
    expect(openSecret(read.encrypted_refresh_token, "refresh")).toBe(
      "test-offline-secret",
    );
    expect(JSON.stringify(read)).not.toContain("test-offline-secret");
    const rights = await db.query<{ allowed: boolean }>(
      "select has_table_privilege('authenticated','runtime_connections','SELECT') or has_function_privilege('anon','read_google_connection()','EXECUTE') as allowed",
    );
    expect(rights.rows[0].allowed).toBe(false);
  });
});
