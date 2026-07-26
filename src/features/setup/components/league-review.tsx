"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createLeagueConfig } from "@/domain/league/defaults";
import type { DraftSnapshot } from "@/domain/draft/types";
import type { LeagueConfig, Position } from "@/domain/league/types";
import type { DraftWarning } from "@/integrations/sleeper/normalize-draft";
import { saveLeagueConfig } from "@/persistence/league-storage";

const positions: Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
const scoringFields = [
  ["Reception points", "reception"],
  ["Pass yard", "passYard"],
  ["Pass touchdown", "passTd"],
  ["Interception", "interception"],
  ["Rush yard", "rushYard"],
  ["Rush touchdown", "rushTd"],
  ["Receiving yard", "receivingYard"],
  ["Receiving touchdown", "receivingTd"],
  ["Fumble lost", "fumbleLost"],
] as const;

type FormValues = {
  teams: string;
  budget: string;
  minBid: string;
  bench: string;
  starters: Record<Position, string>;
  flex: Array<{ count: string; eligible: string }>;
  scoring: Record<(typeof scoringFields)[number][1], string>;
  positionReceptionBonus: Record<"RB" | "WR" | "TE", string>;
  cap: boolean;
};

function formValues(league: LeagueConfig): FormValues {
  return {
    teams: String(league.teams),
    budget: String(league.budget),
    minBid: String(league.minBid),
    bench: String(league.bench),
    starters: Object.fromEntries(
      positions.map((position) => [position, String(league.starters[position])]),
    ) as Record<Position, string>,
    flex: league.flex.map((slot) => ({
      count: String(slot.count),
      eligible: slot.eligible.join(","),
    })),
    scoring: Object.fromEntries(
      scoringFields.map(([, key]) => [key, String(league.scoring[key])]),
    ) as FormValues["scoring"],
    positionReceptionBonus: Object.fromEntries(
      (["RB", "WR", "TE"] as const).map((position) => [
        position,
        String(league.scoring.positionReceptionBonus[position] ?? 0),
      ]),
    ) as FormValues["positionReceptionBonus"],
    cap: league.capKickerDefenseAtOne,
  };
}

function statusLabel(status?: DraftSnapshot["status"]): string {
  if (status === "drafting") return "Live draft";
  if (status === "complete") return "Draft complete";
  if (status === "pre") return "Pre-draft";
  return "Draft status unavailable";
}

export function LeagueReview({
  draftId,
  league,
  importedLeague = league,
  draftStatus,
  warnings = [],
}: {
  draftId: string;
  league: LeagueConfig;
  importedLeague?: LeagueConfig;
  draftStatus?: DraftSnapshot["status"];
  warnings?: DraftWarning[];
}) {
  const router = useRouter();
  const [values, setValues] = useState(() => formValues(league));
  const [edited, setEdited] = useState<Set<string>>(() => new Set());
  const [confirmedUnknownScoring, setConfirmedUnknownScoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scoringWarning = warnings.find((warning) =>
    warning.code.startsWith("SCORING_"),
  );
  const scoringUnknown = scoringWarning?.code === "SCORING_DEFAULTED";

  const markEdited = (key: string) =>
    setEdited((current) => new Set(current).add(key));
  const sourceFor = (key: string, scoringKey?: string) => {
    if (edited.has(key)) return "Local edit";
    if (!scoringKey || !scoringWarning) return "Sleeper import";
    if (
      scoringWarning.code === "SCORING_INFERRED" &&
      scoringKey === "reception"
    ) {
      return "Inferred from scoring type";
    }
    return "Defaulted";
  };
  const field = (
    label: string,
    key: string,
    value: string,
    change: (value: string) => void,
    options: { scoringKey?: string; numeric?: boolean } = {},
  ) => (
    <label>
      {label}
      <span className="source">{sourceFor(key, options.scoringKey)}</span>
      <input
        aria-label={label}
        inputMode={options.numeric === false ? "text" : "decimal"}
        value={value}
        onChange={(event) => {
          markEdited(key);
          setError(null);
          change(event.target.value);
        }}
      />
    </label>
  );

  const fixedCount = positions.reduce(
    (sum, position) => sum + (Number(values.starters[position]) || 0),
    0,
  );
  const flexCount = values.flex.reduce(
    (sum, slot) => sum + (Number(slot.count) || 0),
    0,
  );
  const benchCount = Number(values.bench) || 0;
  const rosterSize = fixedCount + flexCount + benchCount;
  const feasible =
    rosterSize > 0 &&
    Number.isSafeInteger(rosterSize) &&
    Number(values.budget) >= rosterSize * Number(values.minBid);

  const submit = () => {
    if (scoringUnknown && !confirmedUnknownScoring) {
      setError("Verify the scoring rules before setting a strategy.");
      return;
    }
    try {
      const next = createLeagueConfig({
        teams: Number(values.teams),
        budget: Number(values.budget),
        minBid: Number(values.minBid),
        bench: Number(values.bench),
        starters: Object.fromEntries(
          positions.map((position) => [
            position,
            Number(values.starters[position]),
          ]),
        ) as LeagueConfig["starters"],
        flex: values.flex.map((slot) => ({
          count: Number(slot.count),
          eligible: slot.eligible
            .split(",")
            .map((position) => position.trim().toUpperCase())
            .filter(Boolean) as Position[],
        })),
        receptionPoints: Number(values.scoring.reception),
        scoring: {
          ...Object.fromEntries(
            scoringFields
              .filter(([, key]) => key !== "reception")
              .map(([, key]) => [key, Number(values.scoring[key])]),
          ),
          positionReceptionBonus: Object.fromEntries(
            (["RB", "WR", "TE"] as const).map((position) => [
              position,
              Number(values.positionReceptionBonus[position]),
            ]),
          ),
        },
        capKickerDefenseAtOne: values.cap,
      });
      saveLeagueConfig(draftId, next, importedLeague);
      router.push(`/draft/${draftId}/strategy`);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Check the imported settings.",
      );
    }
  };

  return (
    <section className="review" aria-labelledby="review-title">
      <header>
        <p className="kicker">02 / League review</p>
        <div className="setup-status">
          <span>{statusLabel(draftStatus)}</span>
          <span>Sleeper import</span>
        </div>
        <h1 id="review-title">Confirm the room.</h1>
        <p>
          Every imported value is editable here. Changes stay on this device and
          never alter Sleeper.
        </p>
      </header>
      {scoringWarning && (
        <div
          className="scoring-warning"
          role={scoringUnknown ? "alert" : "status"}
        >
          <strong>
            {scoringUnknown
              ? "Sleeper did not provide usable scoring rules."
              : "Sleeper provided only a scoring type."}
          </strong>
          <p>
            {scoringUnknown
              ? "The values below are safe defaults, not confirmed league rules. Correct every affected field and verify them before strategy guidance."
              : "Reception scoring was inferred from the draft type. Other supported fields use labeled defaults; review them before relying on values."}
          </p>
          {scoringUnknown && (
            <label>
              <input
                type="checkbox"
                checked={confirmedUnknownScoring}
                onChange={(event) =>
                  setConfirmedUnknownScoring(event.target.checked)
                }
              />
              I verified the scoring rules
            </label>
          )}
        </div>
      )}
      <div className="roster-summary" role="status">
        <strong>
          {fixedCount} fixed starters · {flexCount} flex · {benchCount} bench ·{" "}
          {rosterSize} total
        </strong>
        <span>{feasible ? "Feasible" : "Not feasible"} at the current budget and minimum bid</span>
      </div>
      <div className="review-grid">
        <section>
          <h2>League basics</h2>
          <div className="field-grid">
            {field("Teams", "teams", values.teams, (value) =>
              setValues((current) => ({ ...current, teams: value })),
            )}
            {field("Auction budget", "budget", values.budget, (value) =>
              setValues((current) => ({ ...current, budget: value })),
            )}
            {field("Minimum bid", "minBid", values.minBid, (value) =>
              setValues((current) => ({ ...current, minBid: value })),
            )}
            {field("Bench slots", "bench", values.bench, (value) =>
              setValues((current) => ({ ...current, bench: value })),
            )}
          </div>
          <h2>Starter slots</h2>
          <div className="field-grid">
            {positions.map((position) => (
              <span key={position}>
                {field(
                  `${position} starters`,
                  `starters.${position}`,
                  values.starters[position],
                  (value) =>
                    setValues((current) => ({
                      ...current,
                      starters: { ...current.starters, [position]: value },
                    })),
                )}
              </span>
            ))}
          </div>
        </section>
        <section>
          <div className="section-title-row">
            <h2>Flex slots</h2>
            <button
              type="button"
              onClick={() => {
                markEdited(`flex.${values.flex.length}`);
                setValues((current) => ({
                  ...current,
                  flex: [
                    ...current.flex,
                    { count: "1", eligible: "RB,WR,TE" },
                  ],
                }));
              }}
            >
              Add flex group
            </button>
          </div>
          {values.flex.length === 0 && (
            <p className="section-note">No flex groups imported. Add one if your room uses flex or superflex.</p>
          )}
          {values.flex.map((flex, index) => (
            <div className="field-grid flex-group" key={index}>
              {field(
                `Flex ${index + 1} slots`,
                `flex.${index}.count`,
                flex.count,
                (value) =>
                  setValues((current) => ({
                    ...current,
                    flex: current.flex.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, count: value } : item,
                    ),
                  })),
              )}
              {field(
                `Flex ${index + 1} eligibility`,
                `flex.${index}.eligible`,
                flex.eligible,
                (value) =>
                  setValues((current) => ({
                    ...current,
                    flex: current.flex.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, eligible: value } : item,
                    ),
                  })),
                { numeric: false },
              )}
              <button
                type="button"
                aria-label={`Remove flex group ${index + 1}`}
                onClick={() => {
                  markEdited(`flex.${index}`);
                  setValues((current) => ({
                    ...current,
                    flex: current.flex.filter(
                      (_, itemIndex) => itemIndex !== index,
                    ),
                  }));
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <h2>Scoring</h2>
          <div className="field-grid">
            {scoringFields.map(([label, key]) => (
              <span key={key}>
                {field(
                  label,
                  `scoring.${key}`,
                  values.scoring[key],
                  (value) =>
                    setValues((current) => ({
                      ...current,
                      scoring: { ...current.scoring, [key]: value },
                    })),
                  { scoringKey: key },
                )}
              </span>
            ))}
            {(["RB", "WR", "TE"] as const).map((position) => (
              <span key={`${position}-bonus`}>
                {field(
                  `${position} reception bonus`,
                  `scoring.bonus.${position}`,
                  values.positionReceptionBonus[position],
                  (value) =>
                    setValues((current) => ({
                      ...current,
                      positionReceptionBonus: {
                        ...current.positionReceptionBonus,
                        [position]: value,
                      },
                    })),
                  { scoringKey: `bonus.${position}` },
                )}
              </span>
            ))}
          </div>
          <label className="cap-toggle">
            <input
              aria-label="K/DEF at $1"
              type="checkbox"
              checked={values.cap}
              onChange={(event) => {
                markEdited("cap");
                setValues((current) => ({
                  ...current,
                  cap: event.target.checked,
                }));
              }}
            />{" "}
            K/DEF at $1 <i className="source">{sourceFor("cap")}</i>
          </label>
        </section>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <footer className="strategy-footer">
        <p>
          {feasible
            ? "Roster size and minimum bids fit this budget."
            : "Correct the roster size, minimum bid, or budget before continuing."}
        </p>
        <button
          className="primary"
          disabled={scoringUnknown && !confirmedUnknownScoring}
          onClick={submit}
        >
          Set strategy
        </button>
      </footer>
    </section>
  );
}
