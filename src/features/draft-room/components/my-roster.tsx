import Link from "next/link";
import { memo } from "react";
import type { DraftRoomViewModel } from "../model";
import styles from "../draft-room.module.css";

export const MyRoster = memo(function MyRoster({
  model,
  onReverseCorrection,
  onEditPurchase,
}: {
  model: DraftRoomViewModel;
  onReverseCorrection?: (playerId: string) => void;
  onEditPurchase?: (playerId: string) => void;
}) {
  const team = model.teams.find((candidate) => candidate.rosterId === model.selectedRosterId);
  if (!team) return null;
  return (
    <section className={styles.roster} aria-labelledby="my-team-title">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>Personal strategy</p>
          <h2 id="my-team-title">{team.name}</h2>
        </div>
        <Link href={`/draft/${model.draftId}/strategy`}>Edit plan</Link>
      </div>
      <dl className={styles.budgetSummary}>
        <div><dt>Remaining</dt><dd>${team.remainingBudget}</dd></div>
        <div>
          <dt>Legal max</dt>
          <dd>{team.maximumLegalBid === null ? "Unavailable" : `$${team.maximumLegalBid}`}</dd>
        </div>
        <div><dt>Open slots</dt><dd>{team.openSlots}</dd></div>
      </dl>
      <div className={styles.rosterList}>
        {team.players.length ? team.players.map((player) => (
          <div key={player.id} className={styles.rosterPlayer}>
            <span>{player.position ?? "?"}</span>
            <strong>{player.name}</strong>
            <span>{player.amount === null ? "—" : `$${player.amount}`}</span>
            {onEditPurchase && model.draftStatus !== "complete" && (
              <button
                className={styles.editPurchase}
                type="button"
                aria-label={`Edit purchase for ${player.name}`}
                onClick={() => onEditPurchase(player.id)}
              >
                Edit
              </button>
            )}
            {player.local && (
              <div className={styles.correction}>
                <small>Local correction</small>
                <button
                  className={styles.criticalAction}
                  type="button"
                  aria-label={`Reverse correction for ${player.name}`}
                  onClick={() => onReverseCorrection?.(player.id)}
                >
                  Reverse
                </button>
              </div>
            )}
          </div>
        )) : <p className={styles.empty}>No purchases yet.</p>}
      </div>
      {model.localCorrections
        .filter((correction) => !team.players.some((player) => player.id === correction.playerId && player.local))
        .map((correction) => (
          <div key={correction.playerId} className={styles.correction}>
            <small><strong>Local correction</strong> · {correction.playerName} · ${correction.amount}</small>
            <button
              className={styles.criticalAction}
              type="button"
              aria-label={`Reverse correction for ${correction.playerName}`}
              onClick={() => onReverseCorrection?.(correction.playerId)}
            >
              Reverse
            </button>
          </div>
        ))}
      {model.ignoredCorrections.map((correction) => (
        <div key={correction.playerId} className={styles.ignoredCorrection}>
          <small>
            <strong>Ignored local conflict</strong> · {correction.playerName} · ${correction.amount}
            <span>{correction.reason}</span>
          </small>
          <button
            className={styles.criticalAction}
            type="button"
            aria-label={`Reverse ignored correction for ${correction.playerName}`}
            onClick={() => onReverseCorrection?.(correction.playerId)}
          >
            Reverse
          </button>
        </div>
      ))}
    </section>
  );
}, (previous, next) =>
  previous.model.draftStatus === next.model.draftStatus &&
  previous.model.selectedRosterId === next.model.selectedRosterId &&
  previous.model.teams === next.model.teams &&
  previous.model.localCorrections === next.model.localCorrections &&
  previous.model.ignoredCorrections === next.model.ignoredCorrections,
);
