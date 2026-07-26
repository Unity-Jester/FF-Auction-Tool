import { memo } from "react";
import type { DraftRoomViewModel } from "../model";
import styles from "../draft-room.module.css";

export const LeagueRosters = memo(function LeagueRosters({
  model,
  onEditPurchase,
}: {
  model: DraftRoomViewModel;
  onEditPurchase?: (playerId: string) => void;
}) {
  return (
    <section className={styles.league} aria-labelledby="league-title">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>Market</p>
          <h2 id="league-title">League rosters</h2>
        </div>
        <span>{model.teams.length} teams</span>
      </div>
      <div className={styles.leagueList}>
        {model.teams.map((team) => (
          <details key={team.rosterId} open={team.rosterId === model.selectedRosterId}>
            <summary>
              <span>{team.name}{team.rosterId === model.selectedRosterId ? " · You" : ""}</span>
              <span>
                ${team.remainingBudget} · max {team.maximumLegalBid === null ? "unavailable" : `$${team.maximumLegalBid}`}
              </span>
            </summary>
            <div>
              {team.players.length ? team.players.map((player) => (
                <p key={player.id}>
                  <span>{player.position ?? "?"} · {player.name}</span>
                  <span>{player.amount === null ? "—" : `$${player.amount}`}</span>
                  {onEditPurchase && model.draftStatus !== "complete" && (
                    <button
                      type="button"
                      aria-label={`Edit league purchase for ${player.name}`}
                      onClick={() => onEditPurchase(player.id)}
                    >
                      Edit
                    </button>
                  )}
                </p>
              )) : <p className={styles.empty}>No purchases yet.</p>}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}, (previous, next) =>
  previous.model.draftStatus === next.model.draftStatus &&
  previous.model.selectedRosterId === next.model.selectedRosterId &&
  previous.model.teams === next.model.teams,
);
