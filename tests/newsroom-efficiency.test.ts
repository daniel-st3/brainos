import { expect, it } from "vitest";
import { visualQARequest } from "../scripts/newsroom/pipeline.mjs";

it("retains full primary evidence and original asset provenance in the shared replay/production QA request", () => {
  const evidence = "Vendor statement. ".repeat(3000) + "IMPORTANT FINAL CAVEAT";
  const input = {
    caption: "No approved opinion",
    claims: [{ text: "Claim", evidence_quote: "Vendor statement." }],
    excerpt: evidence,
    sourceURL: "https://example.test/primary",
    assets: [
      {
        url: "https://example.test/original.png",
        sha256: "abc",
        rights: "UNCLEAR",
      },
    ],
  };
  const request = visualQARequest(input);
  const payload = JSON.parse(
    request.prompt.slice(request.prompt.indexOf("\n") + 1),
  );
  expect(payload.source_excerpt).toBe(evidence);
  expect(payload.claims).toEqual(input.claims);
  expect(payload.source_assets).toEqual(input.assets);
  expect(payload.caption).toBe(input.caption);
  expect(request.prompt).toContain("PHONE SIZE");
  expect(request.prompt).toContain(
    "Rights remain UNCLEAR and always block publication separately",
  );
  expect(request.schema).toMatchObject({
    additionalProperties: false,
    required: ["pass", "findings", "limitations"],
  });
});
