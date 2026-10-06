import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

export type BrowserClient = ReturnType<typeof createBrowserClient<Database>>;

let client: BrowserClient | undefined;

// One client per tab, so realtime channels and auth state are shared.
export function getSupabase(): BrowserClient {
  client ??= createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
  return client;
}
