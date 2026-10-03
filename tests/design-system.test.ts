import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  humanStatus,
  connectionPresentation,
  capabilityLabel,
} from "../src/components/design/status";
describe("integration presentation keeps authentication separate from capabilities", () => {
  it.each([
    "YOUTUBE_PROJECT_AUDIT_PRIVATE_ONLY",
    "BEEHIIV_POSTS_PLAN_ACCESS_REQUIRED",
  ])("%s never turns a connected account into auth-required", (blocker) => {
    expect(connectionPresentation("connected", blocker)).toEqual({
      label: "Connected",
      tone: "positive",
    });
    expect(humanStatus(blocker)).not.toMatch(/connect account/i);
  });
  it("labels unaudited YouTube scoped uploads as private", () => {
    expect(
      capabilityLabel(
        "media_upload",
        "youtube",
        "YOUTUBE_PROJECT_AUDIT_PRIVATE_ONLY",
      ),
    ).toBe("Private upload");
    expect(capabilityLabel("media_upload", "instagram", null)).toBe(
      "Media upload",
    );
  });
  it("keeps X recovery explicit without claiming a connection", () => {
    expect(connectionPresentation(null, "BLOCKED_ACCOUNT_RECOVERY")).toEqual({
      label: "Account recovery required",
      tone: "warning",
    });
  });
  it("does not invent verification for missing or unknown capabilities", () => {
    expect(connectionPresentation(null, null).label).toBe("Account needed");
    expect(humanStatus("UNKNOWN")).toBe("Not verified");
  });
  it("ships self-hosted font files and reduced-motion/no-JS visible editorial surfaces", () => {
    const root = readFileSync("src/app/layout.tsx", "utf8"),
      css = readFileSync("src/app/design-system.css", "utf8"),
      motion = readFileSync("src/components/design/motion.tsx", "utf8");
    expect(root).toContain("next/font/local");
    expect(root).not.toContain("fonts.googleapis.com");
    for (const name of ["newsreader", "manrope", "plex-mono"])
      expect(
        readFileSync(`src/app/fonts/${name}.woff2`).subarray(0, 4).toString(),
      ).toBe("wOF2");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(motion).toContain("observer.disconnect()");
    expect(css).not.toMatch(/\[data-reveal\]\s*\{[^}]*opacity:\s*0/);
  });
});
