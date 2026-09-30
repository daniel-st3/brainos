import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isConnected } from "./repository";
export async function authClient() {
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (items) => {
          try {
            items.forEach(({ name, value, options }) =>
              jar.set(name, value, options),
            );
          } catch {
            /* Server renders are read-only; the proxy refreshes session cookies. */
          }
        },
      },
    },
  );
}
export async function editor() {
  if (!isConnected()) return "Daniel · local demo";
  const client = await authClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (
    error ||
    !user ||
    !process.env.CONTENT_OS_EDITOR_ID ||
    user.id !== process.env.CONTENT_OS_EDITOR_ID
  )
    throw new Error("Unauthorized");
  return user.id;
}
