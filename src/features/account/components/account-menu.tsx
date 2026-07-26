"use client";

import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type FormEvent,
} from "react";

import {
  parsePublicAccountConfig,
  type RawPublicSupabaseConfig,
} from "@/integrations/supabase/config";
import {
  CaptchaChallenge,
  type CaptchaChallengeProps,
} from "./captcha-challenge";

type AccountClient = {
  auth: {
    getSession(): Promise<{ data: { session: Session | null } }>;
    onAuthStateChange(
      callback: (event: AuthChangeEvent, session: Session | null) => void,
    ): { data: { subscription: { unsubscribe(): void } } };
    signInWithOtp(input: {
      email: string;
      options: { emailRedirectTo: string; captchaToken: string };
    }): Promise<{ error: unknown | null }>;
    signOut(): Promise<{ error: unknown | null }>;
  };
};

const authErrorFragmentParams = [
  "error",
  "error_code",
  "error_description",
  "error_reason",
  "error_uri",
] as const;

function recognizedAuthErrorFragment(url: URL): URLSearchParams | null {
  if (!url.hash.includes("=")) return null;
  const params = new URLSearchParams(url.hash.slice(1));
  return authErrorFragmentParams.some((name) => params.has(name))
    ? params
    : null;
}

export function AccountMenu({
  config,
  createClient,
  CaptchaComponent = CaptchaChallenge,
}: {
  config: RawPublicSupabaseConfig | null;
  createClient?: (
    config: NonNullable<ReturnType<typeof parsePublicAccountConfig>>,
  ) => AccountClient;
  CaptchaComponent?: ComponentType<CaptchaChallengeProps>;
}) {
  const validConfig = useMemo(
    () => config ? parsePublicAccountConfig(config) : null,
    [config],
  );
  const injectedClient = useMemo(() => {
    if (!validConfig || !createClient) return null;
    try {
      return createClient(validConfig);
    } catch {
      return null;
    }
  }, [validConfig, createClient]);
  const [loadedClient, setLoadedClient] = useState<AccountClient | null>(null);
  const client = injectedClient ?? loadedClient;
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaAttempt, setCaptchaAttempt] = useState(0);

  useEffect(() => {
    if (!client) return;
    const marker = new URL(window.location.href);
    const fragmentParams = recognizedAuthErrorFragment(marker);
    const hasAuthErrorMarker = marker.searchParams.get("auth") === "error";
    if (
      !hasAuthErrorMarker &&
      !fragmentParams
    ) {
      return;
    }
    const revealError = window.setTimeout(() => {
      setOpen(true);
      setError(
        "That sign-in link could not be used. Request a new one or keep using guest mode.",
      );
      if (hasAuthErrorMarker) marker.searchParams.delete("auth");
      if (fragmentParams) {
        for (const name of authErrorFragmentParams) {
          fragmentParams.delete(name);
        }
        marker.hash = fragmentParams.size > 0
          ? `#${fragmentParams.toString()}`
          : "";
      }
      window.history.replaceState(
        window.history.state,
        "",
        `${marker.pathname}${marker.search}${marker.hash}`,
      );
    }, 0);
    return () => window.clearTimeout(revealError);
  }, [client]);

  useEffect(() => {
    if (!validConfig || createClient) return;
    let active = true;
    void import("@/integrations/supabase/client")
      .then(({ createSupabaseBrowserClient }) => {
        if (active) {
          setLoadedClient(
            createSupabaseBrowserClient(validConfig) as AccountClient,
          );
        }
      })
      .catch(() => {
        if (active) setLoadedClient(null);
      });
    return () => {
      active = false;
    };
  }, [validConfig, createClient]);

  useEffect(() => {
    if (!client) return;
    let active = true;
    void client.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session);
    }).catch(() => {
      if (active) setSession(null);
    });
    const { data } = client.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      window.dispatchEvent(new Event("strategy-auth-change"));
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client]);

  if (!validConfig || !client) return null;

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    setError("");
    setPending(true);
    const next =
      `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", next.startsWith("/") ? next : "/");
    try {
      const result = await client.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: callback.toString(),
          captchaToken,
        },
      });
      if (result.error) throw new Error("Auth provider rejected request");
      setMessage("Check your email for a sign-in link.");
    } catch {
      setError("We could not send a sign-in link. You can keep using guest mode.");
    } finally {
      setPending(false);
      setCaptchaToken("");
      setCaptchaAttempt((value) => value + 1);
    }
  };

  const signOut = async () => {
    setError("");
    try {
      const result = await client.auth.signOut();
      if (result.error) throw new Error("Auth provider rejected request");
    } catch {
      setError("We could not sign out. Please try again.");
      return;
    }
    setSession(null);
    setOpen(false);
    window.dispatchEvent(new Event("strategy-auth-change"));
  };

  return (
    <div className="account-menu">
      <button
        className="account-trigger"
        type="button"
        aria-expanded={open}
        aria-controls="account-panel"
        onClick={() => setOpen((value) => !value)}
      >
        Account
      </button>
      {open ? (
        <div className="account-panel" id="account-panel">
          {session ? (
            <>
              <p>Signed in as {session.user.email ?? "your account"}</p>
              <button type="button" onClick={signOut}>Sign out</button>
            </>
          ) : (
            <form onSubmit={signIn}>
              <p>Optional: sync named strategies across browsers.</p>
              <label>
                Email address
                <input
                  aria-label="Email address"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <CaptchaComponent
                key={captchaAttempt}
                siteKey={validConfig.captchaSiteKey}
                onVerify={setCaptchaToken}
                onExpire={() => setCaptchaToken("")}
              />
              <button type="submit" disabled={pending || !captchaToken}>
                {pending ? "Sending…" : "Email me a sign-in link"}
              </button>
            </form>
          )}
          {message ? <p role="status">{message}</p> : null}
          {error ? <p role="alert">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
