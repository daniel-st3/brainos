import { z } from "zod";
import { createHmac } from "node:crypto";
import type { Rpc } from "../ingestion/store";
export const opportunitySchema = z
  .object({
    kind: z.enum([
      "consulting",
      "speaking",
      "podcast",
      "event",
      "partnership",
      "sponsorship",
      "data_deletion",
    ]),
    name: z.string().trim().min(1).max(200),
    email: z.email().max(254),
    company: z.string().trim().max(200).default(""),
    role: z.string().trim().max(200).default(""),
    company_size: z.string().max(100).default(""),
    current_ai: z.string().max(500).default(""),
    budget: z.string().max(100).default(""),
    details: z.string().trim().min(10).max(4000),
    consent: z.literal(true),
    website: z.string().max(200).default(""),
  })
  .strict();
export async function submitOpportunity(rpc: Rpc, raw: unknown, ip: string) {
  const p = opportunitySchema.parse(raw);
  if (p.website) throw Error("Unable to submit");
  const key = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!key && process.env.CONTENT_OS_MODE === "supabase")
    throw Error("Private intake not configured");
  const hash = createHmac("sha256", key ?? "local-demo-only")
    .update(ip)
    .digest("hex");
  await rpc("submit_opportunity", {
    p_data: {
      kind: p.kind,
      name: p.name,
      email: p.email,
      company: p.company,
      role: p.role,
      details: p.details,
      context: {
        company_size: p.company_size,
        current_ai: p.current_ai,
        budget: p.budget,
      },
    },
    p_hash: hash,
  });
}
