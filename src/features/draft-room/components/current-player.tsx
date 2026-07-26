import { memo } from "react";

import type { DraftRoomPlayer, DraftRoomViewModel } from "../model";
import styles from "../draft-room.module.css";
import { ValueBreakdown } from "./value-breakdown";

export const CurrentPlayer = memo(function CurrentPlayer({
  player,
  guidance,
  recentPurchase,
  onEditRecentPurchase,
}: {
  player: DraftRoomPlayer | null;
  guidance: DraftRoomViewModel["guidance"];
  recentPurchase: DraftRoomViewModel["recentPurchase"];
  onEditRecentPurchase?: (playerId: string) => void;
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
              <dt>Recommended max</dt>
              <dd>${player.recommendedMaxBid}</dd>
            </div>
          </dl>
          <p className={styles.bidLimits}>
            Strategy ceiling ${guidance.budgetPace.strategyMaximum} · Hard legal
            max ${guidance.budgetPace.hardLegalMaximum}
            {guidance.budgetPace.configuredExtraReserve > 0
              ? ` · ${guidance.budgetPace.configuredExtraReserve} extra strategy reserve beyond minimum fill bids`
              : ""}
          </p>
          {guidance.budgetPace.unallocatableSurplus > 0 ? (
            <p className={styles.bidLimits}>
              Across the league, ${guidance.budgetPace.unallocatableSurplus}{" "}
              cannot be assigned while every remaining eligible slot is limited
              by the $1 kicker/defense cap. Team balances remain unchanged.
            </p>
          ) : null}
          <section className={styles.liveGuidance} aria-labelledby="best-fits-title">
            <h2 id="best-fits-title">Best fits now</h2>
            {guidance.bestFits.length > 0 ? (
              <ul className={styles.fitList}>
                {guidance.bestFits.map((fit) => (
                  <li key={fit.playerId}>
                    {fit.playerName} · {fit.fits.join("/")} need
                    {fit.tier
                      ? ` · ${fit.tier.toLocaleLowerCase().replace(/^./, (letter) => letter.toUpperCase())} tier · ${fit.tierSupply} remain`
                      : ""}
                    {" "}· max ${fit.recommendedMaxBid}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No position-specific fit stands out yet.</p>
            )}
            <div className={styles.guidanceGrid}>
              <p>
                Fixed:{" "}
                {Object.entries(guidance.rosterNeeds.fixed)
                  .filter(([, count]) => count > 0)
                  .map(([position, count]) => `${position} ${count}`)
                  .join(" · ") || "filled"}
              </p>
              <p>
                Flex:{" "}
                {guidance.rosterNeeds.flex
                  .map((slot) => `${slot.count} ${slot.eligible.join("/")}`)
                  .join(" · ") || "filled"}
              </p>
              <p>Bench: {guidance.rosterNeeds.bench}</p>
              <p>
                League inflation {guidance.inflation.league.toFixed(2)}× ·{" "}
                {player.position} inflation{" "}
                {guidance.inflation.position[player.position].toFixed(2)}×
              </p>
            </div>
          </section>
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
          {onEditRecentPurchase && (
            <button
              type="button"
              onClick={() => onEditRecentPurchase(recentPurchase.playerId)}
            >
              Edit latest purchase
            </button>
          )}
        </div>
      )}
    </section>
  );
});
