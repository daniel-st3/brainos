import { expect, it } from "vitest";
import { activationError } from "../src/providers/activation-error";
import { ProviderError } from "../src/providers/client";
it("withholds raw provider/database/token errors while retaining actionable codes", () => {
  const secret = "private-fixture-credential";
  expect(
    activationError(new Error(`database connection failed: ${secret}`)),
  ).not.toContain(secret);
  expect(
    activationError(new SyntaxError(`Unexpected token in ${secret}`)),
  ).not.toContain(secret);
  expect(activationError(new ProviderError(`ERROR_${secret}`))).not.toContain(
    secret,
  );
  expect(activationError(new ProviderError("BUFFER_CHANNEL_MISSING"))).toBe(
    "BUFFER_CHANNEL_MISSING",
  );
  expect(
    activationError(new Error("Handle revision changed; regenerate profile")),
  ).toBe("Handle revision changed; regenerate profile");
});
