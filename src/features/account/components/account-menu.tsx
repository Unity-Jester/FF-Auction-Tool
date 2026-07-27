"use client";

import {
  lazy,
  Suspense,
  useMemo,
  useState,
} from "react";

import {
  parsePublicAccountConfig,
} from "@/integrations/supabase/config";
import type {
  AccountMenuImplementationProps,
} from "./account-menu-implementation";

type AccountMenuProps = Omit<AccountMenuImplementationProps, "autoOpen">;

const LazyAccountMenu = lazy(() =>
  import("./account-menu-implementation").then((module) => ({
    default: module.AccountMenuImplementation,
  })),
);

const authErrorFragmentParams = [
  "error",
  "error_code",
  "error_description",
  "error_reason",
  "error_uri",
] as const;

function hasAuthCallbackMarker(): boolean {
  const url = new URL(window.location.href);
  if (url.searchParams.get("auth") === "error") return true;
  if (!url.hash.includes("=")) return false;
  const fragment = new URLSearchParams(url.hash.slice(1));
  return authErrorFragmentParams.some((name) => fragment.has(name));
}

function authStoragePrefix(url: string): string | null {
  try {
    const projectRef = new URL(url).hostname.split(".")[0];
    return projectRef ? `sb-${projectRef}-auth-token` : null;
  } catch {
    return null;
  }
}

function hasExistingSessionEvidence(url: string): boolean {
  const prefix = authStoragePrefix(url);
  if (!prefix) return false;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      if (window.localStorage.key(index)?.startsWith(prefix)) return true;
    }
  } catch {
    // Storage can be blocked while cookie-based sessions remain available.
  }
  return document.cookie
    .split(";")
    .map((entry) => entry.trim().split("=")[0])
    .some((name) => name === prefix || name.startsWith(`${prefix}.`));
}

function AccountButton({ onClick }: { onClick?: () => void }) {
  return (
    <div className="account-menu">
      <button
        className="account-trigger"
        type="button"
        aria-expanded="false"
        aria-controls="account-panel"
        onClick={onClick}
      >
        Account
      </button>
    </div>
  );
}

export function AccountMenu(props: AccountMenuProps) {
  const validConfig = useMemo(
    () => props.config ? parsePublicAccountConfig(props.config) : null,
    [props.config],
  );
  const [loadAccount, setLoadAccount] = useState(() =>
    validConfig && typeof window !== "undefined"
      ? hasAuthCallbackMarker() || hasExistingSessionEvidence(validConfig.url)
      : false
  );
  if (!validConfig) return null;
  if (!loadAccount) {
    return <AccountButton onClick={() => setLoadAccount(true)} />;
  }
  return (
    <Suspense fallback={<AccountButton />}>
      <LazyAccountMenu {...props} autoOpen />
    </Suspense>
  );
}
