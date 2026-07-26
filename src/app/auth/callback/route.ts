import { NextRequest, NextResponse } from "next/server";

import { publicSupabaseConfigFromEnv } from "@/integrations/supabase/config";
import { createSupabaseServerClient } from "@/integrations/supabase/server";

export function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  try {
    const parsed = new URL(value, "https://local.invalid");
    return parsed.origin === "https://local.invalid"
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : "/";
  } catch {
    return "/";
  }
}

export async function GET(request: NextRequest) {
  const config = publicSupabaseConfigFromEnv();
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  const redirect = new URL(next, request.nextUrl.origin);
  const code = request.nextUrl.searchParams.get("code");
  const providerError =
    request.nextUrl.searchParams.has("error") ||
    request.nextUrl.searchParams.has("error_description");
  if (!config || !code || providerError) {
    redirect.searchParams.set("auth", "error");
    return NextResponse.redirect(redirect);
  }
  try {
    const client = await createSupabaseServerClient(config);
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) redirect.searchParams.set("auth", "error");
  } catch {
    redirect.searchParams.set("auth", "error");
  }
  return NextResponse.redirect(redirect);
}
