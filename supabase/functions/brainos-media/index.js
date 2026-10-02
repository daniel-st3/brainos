/* global Deno */
import { deliveryResponse } from "../../../src/providers/delivery-runtime.ts";
// JWT gateway is disabled only because this handler implements per-file 256-bit
// capability authentication and rechecks approval in a private service-only RPC.
Deno.serve((request) => deliveryResponse(request, {
  url: Deno.env.get("SUPABASE_URL"),
  key: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
}));
