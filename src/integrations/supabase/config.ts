import { z } from "zod";

export type PublicSupabaseConfig = {
  url: string;
  anonKey: string;
};

const configSchema = z.object({
  url: z.string().url().refine((value) => {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ||
      (parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname));
  }),
  anonKey: z.string().trim().min(1),
}).strict();

export function parsePublicSupabaseConfig(
  value: Partial<PublicSupabaseConfig>,
): PublicSupabaseConfig | null {
  const parsed = configSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function publicSupabaseConfigFromEnv(): PublicSupabaseConfig | null {
  return parsePublicSupabaseConfig({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}
