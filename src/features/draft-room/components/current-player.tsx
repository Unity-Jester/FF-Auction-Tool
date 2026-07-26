import type { DraftRoomPlayer, DraftRoomViewModel } from "../model";
import styles from "../draft-room.module.css";
import { ValueBreakdown } from "./value-breakdown";

export function CurrentPlayer({
  player,
  recentPurchase,
}: {
  player: DraftRoomPlayer | null;
  recentPurchase: DraftRoomViewModel["recentPurchase"];
}) {
  return (
    <section className={styles.current} aria-label="Selected player">
      <div className={styles.currentContext}>
        <span>User selected</span>
        <span>
          Sleeper’s public draft data does not expose a reliable live nomination.
        </span>
      </div>
      {player ? (
        <>
          <div className={styles.currentHeading}>
            <div>
              <p>{player.position} · {player.team ?? "FA"}</p>
              <h1>{player.name}</h1>
            </div>
            {player.preference !== "neutral" && (
              <span className={styles.preference}>{player.preference}</span>
            )}
          </div>
          <dl className={styles.valueStrip}>
            <div>
              <dt>Base value</dt>
              <dd>${Math.round(player.baseValue)}</dd>
            </div>
            <div>
              <dt>Adjusted value</dt>
              <dd>${Math.round(player.adjustedValue)}</dd>
            </div>
            <div className={styles.maxBid}>
              <dt>My max bid</dt>
              <dd>${player.recommendedMaxBid}</dd>
            </div>
          </dl>
          <ValueBreakdown player={player} />
        </>
      ) : (
        <p className={styles.empty}>Select an available player to see bid guidance.</p>
      )}
      {recentPurchase && (
        <div className={styles.latest}>
          <span>Latest purchase · ${recentPurchase.amount}</span>
          <strong>{recentPurchase.playerName}</strong>
          <span>{recentPurchase.teamName}{recentPurchase.local ? " · local correction" : ""}</span>
        </div>
      )}
    </section>
  );
}
