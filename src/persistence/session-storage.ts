import type { DraftPurchase } from "@/domain/draft/types";
import type { Position } from "@/domain/league/types";
import type { PlayerProjection } from "@/domain/players/types";
import type { PlayerPreference, StrategyConfig } from "@/domain/strategy/types";

export type StoredSessionV1 = {
  version: 1;
  draftId: string;
  strategy: StrategyConfig;
  preferences: Record<string, PlayerPreference>;
  localCorrections: DraftPurchase[];
  csvProjectionOverrides: PlayerProjection[];
  savedAt: string;
};

const prefix = "sleeper-auction-companion:session:";
const positions: Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
const preferences = new Set<PlayerPreference>(["target", "avoid", "lock", "neutral"]);
const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);

export const sessionStorageKey = (draftId: string) => `${prefix}${draftId}`;

function object(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).some((key) => forbiddenKeys.has(key)) ? null : record;
}

function onlyKeys(record: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(record).every((key) => allowed.includes(key));
}

function string(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function date(value: unknown): value is string {
  return string(value) && Number.isFinite(Date.parse(value));
}

function preferenceRecord(value: unknown): Record<string, PlayerPreference> | null {
  const record = object(value);
  if (!record) return null;
  const output: Record<string, PlayerPreference> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (!string(key) || typeof entry !== "string" || !preferences.has(entry as PlayerPreference)) return null;
    output[key] = entry as PlayerPreference;
  }
  return output;
}

function numericRecord(value: unknown): Record<string, number> | null {
  const record = object(value);
  if (!record) return null;
  const output: Record<string, number> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (!string(key) || !finite(entry)) return null;
    output[key] = entry;
  }
  return output;
}

function strategy(value: unknown): StrategyConfig | null {
  const record = object(value);
  if (!record || !onlyKeys(record, ["id", "name", "archetype", "starterBudgetShare", "positionBudgets", "spendingCurve", "qbApproach", "teApproach", "rbBuild", "minReserve", "preferences", "projectionOverrides", "valueOverrides"]) || !string(record.id) || !string(record.name) || !finite(record.starterBudgetShare) || !finite(record.minReserve)) return null;
  if (!(["recommended", "balanced", "stars-and-scrubs", "custom"] as const).includes(record.archetype as StrategyConfig["archetype"])) return null;
  if (!(["auto", "elite", "value"] as const).includes(record.qbApproach as StrategyConfig["qbApproach"])) return null;
  if (!(["auto", "elite", "value"] as const).includes(record.teApproach as StrategyConfig["teApproach"])) return null;
  if (!(["auto", "hero", "zero"] as const).includes(record.rbBuild as StrategyConfig["rbBuild"])) return null;
  const positionBudgets = numericRecord(record.positionBudgets);
  const preferenceValues = preferenceRecord(record.preferences);
  const projectionOverrides = numericRecord(record.projectionOverrides);
  const valueOverrides = numericRecord(record.valueOverrides);
  if (!positionBudgets || !positions.every((position) => finite(positionBudgets[position])) || !preferenceValues || !projectionOverrides || !valueOverrides || !Array.isArray(record.spendingCurve) || !record.spendingCurve.every(finite)) return null;
  return { id: record.id, name: record.name, archetype: record.archetype as StrategyConfig["archetype"], starterBudgetShare: record.starterBudgetShare, positionBudgets: positionBudgets as Record<Position, number>, spendingCurve: [...record.spendingCurve], qbApproach: record.qbApproach as StrategyConfig["qbApproach"], teApproach: record.teApproach as StrategyConfig["teApproach"], rbBuild: record.rbBuild as StrategyConfig["rbBuild"], minReserve: record.minReserve, preferences: preferenceValues, projectionOverrides, valueOverrides };
}

function purchase(value: unknown, source: DraftPurchase["source"]): DraftPurchase | null {
  const record = object(value);
  if (!record || !onlyKeys(record, ["draftId", "playerId", "rosterId", "amount", "pickNo", "createdAt", "source", "keeper"]) || !string(record.draftId) || !string(record.playerId) || !Number.isInteger(record.rosterId) || (record.rosterId as number) < 1 || !finite(record.amount) || (record.amount as number) <= 0 || !Number.isInteger(record.pickNo) || (record.pickNo as number) < 1 || record.source !== source || typeof record.keeper !== "boolean" || !(record.createdAt === null || date(record.createdAt))) return null;
  return record as unknown as DraftPurchase;
}

function projection(value: unknown): PlayerProjection | null {
  const record = object(value);
  const stats = object(record?.stats);
  if (!record || !stats || !onlyKeys(record, ["playerId", "name", "team", "positions", "stats", "source", "updatedAt"]) || !onlyKeys(stats, ["passYards", "passTds", "interceptions", "rushYards", "rushTds", "receptions", "receivingYards", "receivingTds", "fumblesLost"]) || !string(record.playerId) || !string(record.name) || !(record.team === null || string(record.team)) || !Array.isArray(record.positions) || !record.positions.every((position) => positions.includes(position as Position)) || !string(record.source) || !date(record.updatedAt) || !Object.values(stats).every(finite)) return null;
  return record as unknown as PlayerProjection;
}

function validateV1(value: unknown): StoredSessionV1 | null {
  const record = object(value);
  if (!record || !onlyKeys(record, ["version", "draftId", "strategy", "preferences", "localCorrections", "csvProjectionOverrides", "savedAt"]) || record.version !== 1 || !string(record.draftId) || !date(record.savedAt)) return null;
  const validStrategy = strategy(record.strategy);
  const preferenceValues = preferenceRecord(record.preferences);
  if (!validStrategy || !preferenceValues || !Array.isArray(record.localCorrections) || !Array.isArray(record.csvProjectionOverrides)) return null;
  const localCorrections = record.localCorrections.map((item) => purchase(item, "local"));
  const csvProjectionOverrides = record.csvProjectionOverrides.map(projection);
  if (localCorrections.some((item) => !item) || csvProjectionOverrides.some((item) => !item)) return null;
  return { version: 1, draftId: record.draftId, strategy: validStrategy, preferences: preferenceValues, localCorrections: localCorrections as DraftPurchase[], csvProjectionOverrides: csvProjectionOverrides as PlayerProjection[], savedAt: record.savedAt };
}

function migrate(value: unknown): StoredSessionV1 | null {
  const record = object(value);
  if (!record) return null;
  if (record.version === 1) return validateV1(record);
  if (record.version !== 0 || !string(record.draftId) || !date(record.savedAt)) return null;
  const validStrategy = strategy(record.strategy);
  return validStrategy ? { version: 1, draftId: record.draftId, strategy: validStrategy, preferences: {}, localCorrections: [], csvProjectionOverrides: [], savedAt: record.savedAt } : null;
}

function storage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

export function loadSession(draftId: string): StoredSessionV1 | null {
  if (!string(draftId)) return null;
  try {
    const raw = storage()?.getItem(sessionStorageKey(draftId));
    if (!raw) return null;
    const session = migrate(JSON.parse(raw));
    return session?.draftId === draftId ? session : null;
  } catch { return null; }
}

export function saveSession(session: StoredSessionV1): void {
  const valid = validateV1(session);
  if (!valid) return;
  try { storage()?.setItem(sessionStorageKey(valid.draftId), JSON.stringify(valid)); } catch { /* Browser storage is optional. */ }
}

export function clearSession(draftId: string): void {
  if (!string(draftId)) return;
  try { storage()?.removeItem(sessionStorageKey(draftId)); } catch { /* Browser storage is optional. */ }
}
