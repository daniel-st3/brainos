import type { Provider } from "../control/model";
import { OfficialClient, type TokenSet, type Transport } from "./client";
import { BufferClient } from "./buffer-client";
export function providerClient(
  provider: Provider,
  tokens: TokenSet,
  send: Transport = fetch,
  writes = false,
) {
  return tokens.transport === "buffer"
    ? new BufferClient(provider, tokens, send, writes)
    : new OfficialClient(provider, tokens, send, writes);
}
