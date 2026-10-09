import { afterEach, expect, it, vi } from "vitest";
import {
  issueReviewLink,
  verifyReviewLink,
  reviewLinkLifetime,
} from "../src/approval/review-link";
import { sealSecret } from "../src/integrations/google-oauth";
import type { Review } from "../src/approval/service";
const owner = "4bf51631-dfff-4520-9f9b-6db774defaa9";
function fixture() {
  vi.stubEnv("CONTENT_OS_EDITOR_ID", owner);
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "a".repeat(64));
  return {
    id: "f7f96c57-91b2-44d9-8f72-32fb297fc5c5",
    data: {
      checksum: "b".repeat(64),
      state: "AWAITING_DANIEL",
      decision: null,
    },
  } as Review;
}
afterEach(() => vi.unstubAllEnvs());
it("binds access to one exact candidate, checksum and owner", () => {
  const r = fixture(),
    t = issueReviewLink(r, 100);
  expect(verifyReviewLink(t, r, 101).actor).toBe(owner);
  expect(() =>
    verifyReviewLink(t, { ...r, id: crypto.randomUUID() }, 101),
  ).toThrow();
  expect(() =>
    verifyReviewLink(
      t,
      { ...r, data: { ...r.data, checksum: "c".repeat(64) } },
      101,
    ),
  ).toThrow();
  vi.stubEnv("CONTENT_OS_EDITOR_ID", crypto.randomUUID());
  expect(() => verifyReviewLink(t, r, 101)).toThrow();
});
it("rejects tampering, expiry, future grants, stale candidates and credential-context confusion", () => {
  const r = fixture(),
    t = issueReviewLink(r, 1000);
  expect(() => verifyReviewLink(t.slice(0, -4) + "AAAA", r, 1001)).toThrow();
  expect(() =>
    verifyReviewLink(t, r, 1000 + reviewLinkLifetime * 1000),
  ).toThrow();
  expect(() => verifyReviewLink(t, r, 999)).toThrow();
  expect(() =>
    verifyReviewLink(t, { ...r, data: { ...r.data, state: "STALE" } }, 1001),
  ).toThrow();
  expect(() =>
    verifyReviewLink(sealSecret("{}", "refresh"), r, 1001),
  ).toThrow();
});
it("cannot mint a new decision grant for a closed candidate and records only a grant fingerprint", () => {
  const r = fixture(),
    t = issueReviewLink(r);
  const result = verifyReviewLink(t, r);
  expect(result.audit.grant_sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(result)).not.toContain(t);
  expect(() =>
    issueReviewLink({ ...r, data: { ...r.data, state: "REJECTED" } }),
  ).toThrow();
});
