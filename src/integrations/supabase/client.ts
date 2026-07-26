import { createBrowserClient } from "@supabase/ssr";

import type { PublicSupabaseConfig } from "./config";

export function createSupabaseBrowserClient(config: PublicSupabaseConfig) {
  return createBrowserClient(config.url, config.anonKey);
}
