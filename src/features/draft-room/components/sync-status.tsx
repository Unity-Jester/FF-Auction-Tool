import type { DraftSyncStatus } from "@/features/draft-session/use-draft-sync";
import styles from "../draft-room.module.css";

export function SyncStatus({
  status,
  lastUpdatedAt,
  onRetry,
}: {
  status: DraftSyncStatus;
  lastUpdatedAt: string | null;
  onRetry: () => void;
}) {
  const label = status[0].toUpperCase() + status.slice(1);
  const updated = lastUpdatedAt
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(lastUpdatedAt))
    : "Never";
  return (
    <div className={styles.sync}>
      <span className={styles[status]} aria-hidden="true" />
      <strong role="status" aria-live="polite" aria-atomic="true">{label}</strong>
      <span>Updated {updated}</span>
      {status !== "fresh" && (
        <button className={styles.criticalAction} type="button" onClick={onRetry}>Retry sync</button>
      )}
    </div>
  );
}
