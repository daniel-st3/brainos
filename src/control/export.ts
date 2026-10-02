import type { ControlState } from "./model";
import type { Story } from "../domain/types";
import type { StudioState } from "../production/types";
import { personalDriveConfiguration } from "../integrations/personal-drive";
const secretKey =
  /token|secret|password|credential|ciphertext|service.?key|encryption.?key|lease_token/i;
export function portable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(portable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !secretKey.test(key))
        .map(([key, v]) => [key, portable(v)]),
    );
  return value;
}
export function projectExport(
  state: ControlState,
  stories: Story[],
  production: StudioState,
  history: Record<string, unknown> = {},
) {
  let root: string | null = null;
  try {
    root = personalDriveConfiguration().root;
  } catch {}
  return portable({
    schema_version: 1,
    exported_at: new Date().toISOString(),
    scope:
      "editorial/control/production metadata; excludes credentials and subscriber PII",
    history,
    control: state,
    stories,
    production,
    media_references: production.packages.flatMap((p) =>
      p.data.media.map((m) => ({
        provider: m.provider,
        file_id: m.file_id,
        story_id: m.story_id,
        draft_id: m.draft_id,
        sha256: m.sha256,
      })),
    ),
    drive_root: root,
  }) as Record<string, unknown>;
}
export function csv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const keys = [...new Set(rows.flatMap(Object.keys))];
  const cell = (value: unknown) => {
    let s =
      typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
    if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
    return `"${s.replaceAll('"', '""')}"`;
  };
  return [
    keys.map(cell).join(","),
    ...rows.map((r) => keys.map((k) => cell(portable(r[k]))).join(",")),
  ].join("\n");
}
