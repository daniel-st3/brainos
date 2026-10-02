import { expect, it } from "vitest";
import { validatePublicLink } from "../src/control/public-link";

it.each([
  "https://user:password@example.com/",
  "http://example.com/",
  "https://localhost/",
  "https://127.0.0.1/",
  "https://[::1]/",
  "https://10.0.0.1/",
  "https://drive.google.com/file/d/private",
  "https://docs.google.com/document/d/private",
  "https://project.supabase.co/storage/v1/object/sign/private?token=private",
  "https://example.com/file?api_key=private",
  "https://example.com/file?signature=private",
])("blocks private or credential-bearing public destination %s", (url) => {
  expect(() => validatePublicLink(url)).toThrow();
});
it("allows ordinary public profile and campaign destinations", () => {
  expect(
    validatePublicLink("https://www.youtube.com/@daniel?utm_source=brainos"),
  ).toBe("https://www.youtube.com/@daniel?utm_source=brainos");
});
