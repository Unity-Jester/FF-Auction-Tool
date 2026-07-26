import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

type PublicEnvironment = Record<string, string | undefined>;

function safeHttpsOrigin(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function buildSecurityHeaders(
  environment: PublicEnvironment = process.env,
) {
  const supabaseOrigin = safeHttpsOrigin(
    environment.NEXT_PUBLIC_SUPABASE_URL,
  );
  const developmentScript =
    environment.NODE_ENV === "production" ? "" : " 'unsafe-eval'";
  const connectSources = [
    "'self'",
    supabaseOrigin,
    "https://hcaptcha.com",
    "https://*.hcaptcha.com",
  ].filter(Boolean).join(" ");
  const contentSecurityPolicy = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${developmentScript} https://hcaptcha.com https://*.hcaptcha.com`,
    "style-src 'self' 'unsafe-inline' https://hcaptcha.com https://*.hcaptcha.com",
    "img-src 'self' data: blob: https://hcaptcha.com https://*.hcaptcha.com",
    `connect-src ${connectSources}`,
    "frame-src https://hcaptcha.com https://*.hcaptcha.com",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
    { key: "Content-Security-Policy", value: contentSecurityPolicy },
    ...(environment.NODE_ENV === "production"
      ? [{
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        }]
      : []),
  ];
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: {
    root: projectRoot,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: buildSecurityHeaders(),
      },
    ];
  },
};

export default nextConfig;
