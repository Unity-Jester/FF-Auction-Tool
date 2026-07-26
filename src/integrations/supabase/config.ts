import { z } from "zod";

export type PublicSupabaseConfig = {
  url: string;
  publicKey: string;
};

export type PublicAccountConfig = PublicSupabaseConfig & {
  captchaSiteKey: string;
};

export type RawPublicSupabaseConfig = {
  url?: string;
  publishableKey?: string;
  anonKey?: string;
  publicKey?: string;
  captchaSiteKey?: string;
};

const urlSchema = z.string().url().refine((value) => {
  const parsed = new URL(value);
  return parsed.protocol === "https:" ||
    (parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(parsed.hostname));
});

function normalizedKey(value: RawPublicSupabaseConfig): string {
  return (
    value.publishableKey?.trim() ||
    value.publicKey?.trim() ||
    value.anonKey?.trim() ||
    ""
  );
}

export function parsePublicSupabaseConfig(
  value: RawPublicSupabaseConfig,
): PublicSupabaseConfig | null {
  const url = urlSchema.safeParse(value.url);
  const publicKey = normalizedKey(value);
  if (
    !url.success ||
    !publicKey ||
    publicKey.startsWith("sb_secret_") ||
    publicKey.toLowerCase().includes("service_role")
  ) {
    return null;
  }
  return { url: url.data, publicKey };
}

export function parsePublicAccountConfig(
  value: RawPublicSupabaseConfig,
): PublicAccountConfig | null {
  const config = parsePublicSupabaseConfig(value);
  const captchaSiteKey = value.captchaSiteKey?.trim();
  return config && captchaSiteKey
    ? { ...config, captchaSiteKey }
    : null;
}

function configFromEnv(): RawPublicSupabaseConfig {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    captchaSiteKey: process.env.NEXT_PUBLIC_SUPABASE_CAPTCHA_SITE_KEY,
  };
}

export function publicSupabaseConfigFromEnv(): PublicSupabaseConfig | null {
  return parsePublicSupabaseConfig(configFromEnv());
}

export function publicAccountConfigFromEnv(): PublicAccountConfig | null {
  return parsePublicAccountConfig(configFromEnv());
}
