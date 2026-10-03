import { visualSpecSchema, type VisualSpec } from "./schema";
/** Creative CSS variables only from an explicit story spec. No product UI fallback. */
export function creativeTokens(raw: VisualSpec): Record<string, string> {
  const spec = visualSpecSchema.parse(raw),
    tokens: Record<string, string> = {};
  for (const color of spec.palette?.colors ?? []) {
    if (!/^[a-z][a-z0-9_-]{0,79}$/.test(color.role))
      throw Error("Use a safe palette role identifier");
    const key = `--creative-color-${color.role}`;
    if (key in tokens) throw Error("Duplicate creative color role");
    tokens[key] = color.value;
  }
  for (const type of spec.typography) {
    if (!/^[a-z][a-z0-9_-]{0,79}$/.test(type.role))
      throw Error("Use a safe typography role identifier");
    const key = `--creative-font-${type.role}`;
    if (type.family) {
      if (
        key in tokens ||
        /[;{}<>]/.test(type.family) ||
        /url\s*\(/i.test(type.family)
      )
        throw Error("Invalid creative font family");
      tokens[key] = type.family;
    }
  }
  return tokens;
}
