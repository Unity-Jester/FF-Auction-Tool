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

function safePublicKey(value: string): boolean {
  const normalized = value.toLowerCase();
  if (
    normalized.startsWith("sb_secret_") ||
    normalized.includes("service_role")
  ) {
    return false;
  }
  const jwtParts = value.split(".");
  if (jwtParts.length !== 3) return true;
  try {
    const payload = jwtParts[1]
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(jwtParts[1].length / 4) * 4, "=");
    const role = JSON.parse(atob(payload)) as { role?: unknown };
    return role.role === "anon";
  } catch {
    return false;
  }
}

export function parsePublicSupabaseConfig(
  value: RawPublicSupabaseConfig,
): PublicSupabaseConfig | null {
  const url = urlSchema.safeParse(value.url);
  const publicKey = normalizedKey(value);
  if (
    !url.success ||
    !publicKey ||
    !safePublicKey(publicKey)
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
