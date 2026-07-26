"use client";

import { useMemo, useState } from "react";
import type { Position } from "@/domain/league/types";
import type { DraftRoomPlayer } from "../model";
import styles from "../draft-room.module.css";

const positions: Array<Position | "ALL"> = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"];
type Sort = "max" | "adjusted" | "base" | "points";

export function PlayerBoard({
  players,
  selectedPlayerId,
  onSelectPlayer,
}: {
  players: DraftRoomPlayer[];
  selectedPlayerId: string | null;
  onSelectPlayer: (playerId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<Position | "ALL">("ALL");
  const [sort, setSort] = useState<Sort>("max");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return players
      .filter((player) =>
        (position === "ALL" || player.position === position) &&
        (!normalized ||
          player.name.toLocaleLowerCase().includes(normalized) ||
          player.team?.toLocaleLowerCase().includes(normalized)))
      .sort((a, b) => {
        const left = sort === "max" ? a.recommendedMaxBid : sort === "adjusted" ? a.adjustedValue : sort === "base" ? a.baseValue : a.points;
        const right = sort === "max" ? b.recommendedMaxBid : sort === "adjusted" ? b.adjustedValue : sort === "base" ? b.baseValue : b.points;
        return right - left || a.name.localeCompare(b.name);
      });
  }, [players, position, query, sort]);
  const move = (currentId: string, delta: number) => {
    const index = filtered.findIndex((player) => player.id === currentId);
    const next = filtered[Math.max(0, Math.min(filtered.length - 1, index + delta))];
    if (next) {
      onSelectPlayer(next.id);
      document.getElementById(`player-${next.id}`)?.focus();
    }
  };
  return (
    <section className={styles.board} aria-labelledby="players-title">
      <div className={styles.boardTools}>
        <div>
          <p className={styles.eyebrow}>Available</p>
          <h2 id="players-title">Player board</h2>
        </div>
        <label className={styles.search}>
          <span>Search available players</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name or team"
          />
        </label>
        <label className={styles.sort}>
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
            <option value="max">My max bid</option>
            <option value="adjusted">Adjusted value</option>
            <option value="base">Base value</option>
            <option value="points">Projected points</option>
          </select>
        </label>
        <div className={styles.filters} aria-label="Position filters">
          {positions.map((item) => (
            <button
              type="button"
              key={item}
              aria-pressed={position === item}
              onClick={() => setPosition(item)}
            >
              {item === "ALL" ? "All" : item}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr><th>Player</th><th>Proj</th><th>Base</th><th>Adjusted</th><th>My max</th></tr>
          </thead>
          <tbody>
            {filtered.map((player) => (
              <tr
                key={player.id}
                aria-selected={selectedPlayerId === player.id}
                onClick={() => onSelectPlayer(player.id)}
              >
                <th scope="row">
                  <button
                    id={`player-${player.id}`}
                    type="button"
                    onClick={() => onSelectPlayer(player.id)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown") { event.preventDefault(); move(player.id, 1); }
                      if (event.key === "ArrowUp") { event.preventDefault(); move(player.id, -1); }
                    }}
                  >
                    <span>{player.name}</span>
                    <small>{player.team ?? "FA"} · {player.position}{player.preference !== "neutral" ? ` · ${player.preference}` : ""}</small>
                  </button>
                </th>
                <td>{player.points.toFixed(1)}</td>
                <td>${Math.round(player.baseValue)}</td>
                <td>${Math.round(player.adjustedValue)}</td>
                <td className={styles.bidCell}>${player.recommendedMaxBid}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className={styles.empty}>No players match these filters.</p>}
      </div>
    </section>
  );
}
