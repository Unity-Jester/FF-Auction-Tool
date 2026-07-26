"use client";

import { useEffect, useRef, useState } from "react";
import styles from "@/features/draft-room/draft-room.module.css";

export function Methodology({ projectionSource, projectionStale }: { projectionSource: string; projectionStale: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); queueMicrotask(() => trigger.current?.focus()); };
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const invokingControl = trigger.current;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key === "Tab") {
        const nodes = dialog.current?.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); invokingControl?.focus(); };
  }, [open]);
  return <>
    <button ref={trigger} className={styles.helpTrigger} type="button" onClick={() => setOpen(true)}>How values work</button>
    {open && <div className={styles.helpBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div ref={dialog} className={styles.helpDialog} role="dialog" aria-modal="true" aria-labelledby="methodology-title" tabIndex={-1}>
        <div className={styles.helpHeading}><h2 id="methodology-title">How values work</h2><button type="button" onClick={close}>Close help</button></div>
        <p><strong>Projection source:</strong> {projectionSource}. {projectionStale ? "This source is stale, so treat values cautiously." : "Freshness is shown in the draft room."}</p>
        <h3>From points to dollars</h3><p>League scoring turns projections into points. We set replacement levels and VORP (value over replacement) from your starting lineup and flex requirements, then share the available dollar pool across useful players.</p>
        <h3>What each number means</h3><p>Base value is the VORP-based starting point. Adjusted value applies your strategy and player preferences. My max bid also protects the minimum bids required for your remaining roster slots; it is a budget limit, not a prediction.</p>
        <h3>Draft context and limits</h3><p>Roster needs, inflation, tier scarcity, and your preferences can change adjusted values as purchases arrive. Projections, injuries, draft settings, and market behavior can be wrong or late. This tool does not claim to predict who will be nominated or purchased next.</p>
      </div>
    </div>}
  </>;
}
