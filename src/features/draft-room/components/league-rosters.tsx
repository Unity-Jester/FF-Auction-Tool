import type { DraftRoomViewModel } from "../model";
import styles from "../draft-room.module.css";

export function LeagueRosters({ model }: { model: DraftRoomViewModel }) {
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
              <span>${team.remainingBudget} · max ${team.maximumLegalBid}</span>
            </summary>
            <div>
              {team.players.length ? team.players.map((player) => (
                <p key={player.id}>
                  <span>{player.position ?? "?"} · {player.name}</span>
                  <span>{player.amount === null ? "—" : `$${player.amount}`}</span>
                </p>
              )) : <p className={styles.empty}>No purchases yet.</p>}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
