"use client";

import { useId } from "react";
import styles from "@/features/draft-room/draft-room.module.css";

export type RecoveryCode =
  | "RATE_LIMITED" | "OFFLINE" | "UNSUPPORTED_DRAFT_TYPE" | "NOT_FOUND"
  | "PROJECTIONS_UNAVAILABLE" | "SETUP_MISMATCH" | "STORAGE" | "AUTH" | "UNKNOWN";

const guidance: Record<RecoveryCode, { title: string; detail: string }> = {
  RATE_LIMITED: { title: "Sleeper is limiting requests.", detail: "Wait a moment, then try again. Your last known board and values remain visible." },
  OFFLINE: { title: "You appear to be offline.", detail: "Reconnect, then retry. Your last known board and values remain visible." },
  UNSUPPORTED_DRAFT_TYPE: { title: "This is not an auction draft.", detail: "Choose a Sleeper auction draft to use this companion." },
  NOT_FOUND: { title: "Sleeper could not find this draft.", detail: "Check the draft link or ID, then try again." },
  PROJECTIONS_UNAVAILABLE: { title: "Projection data is temporarily unavailable.", detail: "Your draft board is safe; retry the supporting data shortly." },
  SETUP_MISMATCH: { title: "Your saved setup no longer matches this draft.", detail: "Review setup before relying on the values." },
  STORAGE: { title: "This browser could not save draft changes.", detail: "Local corrections may not persist until browser storage is available." },
  AUTH: { title: "Account access needs attention.", detail: "Drafting can continue as a guest. Sign in again to save strategies." },
  UNKNOWN: { title: "Draft data could not be refreshed.", detail: "Try again shortly. Your last known board and values remain visible." },
};

export function recoveryCode(error: unknown): RecoveryCode {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (["RATE_LIMITED", "UNSUPPORTED_DRAFT_TYPE", "NOT_FOUND", "PROJECTIONS_UNAVAILABLE"].includes(code)) return code as RecoveryCode;
  if (typeof navigator !== "undefined" && !navigator.onLine) return "OFFLINE";
  return "UNKNOWN";
}

export function RecoveryPanel({ code = "UNKNOWN", lastUpdatedAt, onRetry }: {
  code?: RecoveryCode;
  lastUpdatedAt: string | null;
  onRetry?: () => void;
}) {
  const headingId = useId();
  const message = guidance[code];
  const timestamp = lastUpdatedAt && new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(lastUpdatedAt));
  return <section className={styles.recovery} aria-labelledby={headingId}>
    <h2 id={headingId}>{message.title}</h2>
    <p>{message.detail}</p>
    {timestamp && <p>Last successful update: {timestamp}.</p>}
    {onRetry && <button className={styles.criticalAction} type="button" onClick={onRetry}>Retry sync</button>}
  </section>;
}
