import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { PublicSupabaseConfig } from "./config";

export async function createSupabaseServerClient(config: PublicSupabaseConfig) {
  const cookieStore = await cookies();
  return createServerClient(config.url, config.publicKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (values) => {
        try {
          values.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Components cannot write cookies; callback routes can.
        }
      },
    },
  });
}
