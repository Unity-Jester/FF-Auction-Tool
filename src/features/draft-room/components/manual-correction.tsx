import type { ReactNode } from "react";
import styles from "../draft-room.module.css";

/** Shared explanatory wrapper for corrections; the parent owns draft-specific validation. */
export function ManualCorrection({ playerName, children }: { playerName: string; children: ReactNode }) {
  return <fieldset className={styles.manualCorrection}>
    <legend>Local purchase correction for {playerName}</legend>
    <p>This records a local estimate on this device. Sleeper remains authoritative and can replace it on a later sync. You can remove the correction from My team.</p>
    <label>Player
      <input aria-label="Player" value={playerName} readOnly required />
    </label>
    {children}
  </fieldset>;
}
