"use client";

import { useState } from "react";

import type { DraftRoomPlayer } from "../model";
import styles from "../draft-room.module.css";

export function ValueBreakdown({ player }: { player: DraftRoomPlayer }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.breakdown}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? "Hide value breakdown" : "Why this value?"}
      </button>
      {open && (
        <div className={styles.breakdownBody}>
          <p>{player.explanation}</p>
          <dl>
            {player.adjustments.map((adjustment, index) => (
              <div key={`${adjustment.label}-${index}`}>
                <dt>{adjustment.label}</dt>
                <dd>
                  {adjustment.delta >= 0 ? "+" : "−"}$
                  {Math.abs(adjustment.delta).toFixed(2)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
