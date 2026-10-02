import { ProviderError } from "./client";
import { ZodError } from "zod";

/** Provider bodies, database exceptions and JSON payloads stay out of the UI. */
export function activationError(error: unknown) {
  if (
    error instanceof ProviderError &&
    /^[A-Z][A-Z0-9_]{1,100}$/.test(error.code)
  )
    return error.code;
  if (error instanceof ZodError) return "Check the required activation fields";
  const allowed = new Set([
    "Invalid private API credential",
    "Account missing",
    "Record missing",
    "Request too large",
    "Connect real accounts in the live workspace",
    "Verify a connected publish-capable account first",
    "Approve an active brand revision first",
    "Confirm the intended handle identity first",
    "Record the intended handle first",
    "Provider bio character limit exceeded",
    "Generate a new profile revision before editing approved copy",
    "Brand revision changed; regenerate profile",
    "Handle revision changed; regenerate profile",
    "A public HTTPS URL is required",
    "Use a public destination without credentials, private Drive, or storage access links",
  ]);
  if (error instanceof Error && allowed.has(error.message))
    return error.message;
  if (
    error instanceof Error &&
    /^(instagram|tiktok|x|youtube): developer application credentials and stable HTTPS origin required$/.test(
      error.message,
    )
  )
    return error.message;
  return "Activation failed. Check connection status and retry; private provider details are withheld.";
}
