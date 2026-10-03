import { personalDriveConfiguration } from "./personal-drive";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  timingSafeEqual,
} from "node:crypto";
export const gmailSendScope = "https://www.googleapis.com/auth/gmail.send";
export const googleDriveScope = "https://www.googleapis.com/auth/drive";
export const oauthCookie = "brainos_google_oauth";
const purpose = "brainos-google-oauth-v1";
function key() {
  const value = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value))
    throw new Error("Runtime integration encryption key is not configured.");
  return Buffer.from(value, "hex");
}
export function sealSecret(value: string, context: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(`${purpose}:${context}`));
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    data.toString("base64url"),
  ].join(".");
}
export function openSecret(value: string, context: string) {
  const [version, nonce, tag, ciphertext, ...rest] = value.split(".");
  if (version !== "v1" || !nonce || !tag || !ciphertext || rest.length)
    throw new Error("Invalid encrypted credential.");
  const previous = process.env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS;
  const keys = [
    key(),
    ...(previous && /^[a-f0-9]{64}$/i.test(previous)
      ? [Buffer.from(previous, "hex")]
      : []),
  ];
  for (const candidate of keys) {
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        candidate,
        Buffer.from(nonce, "base64url"),
      );
      decipher.setAAD(Buffer.from(`${purpose}:${context}`));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {}
  }
  throw Error("Invalid encrypted credential or key; no credential logged");
}
export function oauthConfiguration() {
  const origin = process.env.CONTENT_OS_ORIGIN,
    clientId = process.env.GOOGLE_CLIENT_ID,
    clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (
    process.env.CONTENT_OS_MODE !== "supabase" ||
    !origin ||
    !clientId ||
    !clientSecret ||
    !process.env.GOOGLE_DRIVE_ROOT_ID
  )
    throw new Error(
      "Google OAuth requires hosted origin, Supabase, OAuth client credentials and the existing Drive root.",
    );
  const parsed = new URL(origin);
  if (parsed.protocol !== "https:" || parsed.origin !== origin)
    throw new Error("OAuth origin must be an exact HTTPS origin.");
  key();
  personalDriveConfiguration();
  return {
    origin,
    clientId,
    clientSecret,
    redirectUri: `${origin}/api/integrations/google/callback`,
  };
}
export function createConsent(
  actor: string,
  now = Date.now(),
  notifications = false,
) {
  const config = oauthConfiguration();
  const state = randomBytes(32).toString("base64url"),
    verifier = randomBytes(32).toString("base64url");
  const cookie = sealSecret(
    JSON.stringify({
      actor,
      state,
      verifier,
      notifications,
      expires: now + 600000,
    }),
    "state",
  );
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: notifications
      ? `${googleDriveScope} ${gmailSendScope}`
      : googleDriveScope,
    include_granted_scopes: "true",
    access_type: "offline",
    prompt: "consent select_account",
    login_hint: personalDriveConfiguration().email,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { cookie, url: url.toString() };
}
export function validateConsentDetails(
  cookie: string,
  state: string,
  actor: string,
  now = Date.now(),
) {
  const decoded = JSON.parse(openSecret(cookie, "state")) as {
    actor: string;
    state: string;
    verifier: string;
    expires: number;
    notifications?: boolean;
  };
  const expected = Buffer.from(decoded.state),
    actual = Buffer.from(state);
  if (
    decoded.actor !== actor ||
    !Number.isFinite(decoded.expires) ||
    decoded.expires <= now ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    throw new Error("OAuth request expired or does not match this editor.");
  return {
    verifier: decoded.verifier,
    notifications: decoded.notifications === true,
  };
}

export function validateConsent(
  cookie: string,
  state: string,
  actor: string,
  now = Date.now(),
) {
  return validateConsentDetails(cookie, state, actor, now).verifier;
}
