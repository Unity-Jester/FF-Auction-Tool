import Link from "next/link";
import type { DraftRoomViewModel } from "../model";
import styles from "../draft-room.module.css";

export function MyRoster({
  model,
  onReverseCorrection,
}: {
  model: DraftRoomViewModel;
  onReverseCorrection?: (playerId: string) => void;
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
        <div><dt>Legal max</dt><dd>${team.maximumLegalBid}</dd></div>
        <div><dt>Open slots</dt><dd>{team.openSlots}</dd></div>
      </dl>
      <div className={styles.rosterList}>
        {team.players.length ? team.players.map((player) => (
          <div key={player.id} className={styles.rosterPlayer}>
            <span>{player.position ?? "?"}</span>
            <strong>{player.name}</strong>
            <span>{player.amount === null ? "—" : `$${player.amount}`}</span>
            {player.local && (
              <div className={styles.correction}>
                <small>Local correction</small>
                <button
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
              type="button"
              aria-label={`Reverse correction for ${correction.playerName}`}
              onClick={() => onReverseCorrection?.(correction.playerId)}
            >
              Reverse
            </button>
          </div>
        ))}
    </section>
  );
}
