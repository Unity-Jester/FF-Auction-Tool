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
export const SESSION_LIMITS = {
  maxBytes: 1_000_000,
  maxPreferences: 500,
  maxCorrections: 500,
  maxCsvProjections: 2_000,
  maxRecordKeys: 500,
  maxStringLength: 256,
  maxCurveEntries: 64,
  maxNumber: 1_000_000,
} as const;

export const sessionStorageKey = (draftId: string) => `${prefix}${draftId}`;

function object(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return keys.length > SESSION_LIMITS.maxRecordKeys ||
    keys.some(
      (key) =>
        forbiddenKeys.has(key) || key.length > SESSION_LIMITS.maxStringLength,
    )
    ? null
    : record;
}

function onlyKeys(record: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(record).every((key) => allowed.includes(key));
}

function string(
  value: unknown,
  maximum: number = SESSION_LIMITS.maxStringLength,
): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function date(value: unknown): value is string {
  return string(value) && Number.isFinite(Date.parse(value));
}

function preferenceRecord(value: unknown): Record<string, PlayerPreference> | null {
  const record = object(value);
  if (!record || Object.keys(record).length > SESSION_LIMITS.maxPreferences) return null;
  const output: Record<string, PlayerPreference> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (!string(key) || typeof entry !== "string" || !preferences.has(entry as PlayerPreference)) return null;
    output[key] = entry as PlayerPreference;
  }
  return output;
}

function numericRecord(
  value: unknown,
  options: { nonnegative?: boolean } = {},
): Record<string, number> | null {
  const record = object(value);
  if (!record) return null;
  const output: Record<string, number> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (
      !string(key) ||
      !finite(entry) ||
      Math.abs(entry) > SESSION_LIMITS.maxNumber ||
      (options.nonnegative && entry < 0)
    ) return null;
    output[key] = entry;
  }
  return output;
}

function strategy(value: unknown): StrategyConfig | null {
  const record = object(value);
  if (!record || !onlyKeys(record, ["id", "name", "archetype", "starterBudgetShare", "positionBudgets", "spendingCurve", "qbApproach", "teApproach", "rbBuild", "minReserve", "preferences", "projectionOverrides", "valueOverrides"]) || !identifier(record.id) || !string(record.name) || !finite(record.starterBudgetShare) || record.starterBudgetShare < 0 || record.starterBudgetShare > 1 || !safeInteger(record.minReserve) || record.minReserve < 0 || record.minReserve > SESSION_LIMITS.maxNumber) return null;
  if (!(["recommended", "balanced", "stars-and-scrubs", "custom"] as const).includes(record.archetype as StrategyConfig["archetype"])) return null;
  if (!(["auto", "elite", "value"] as const).includes(record.qbApproach as StrategyConfig["qbApproach"])) return null;
  if (!(["auto", "elite", "value"] as const).includes(record.teApproach as StrategyConfig["teApproach"])) return null;
  if (!(["auto", "hero", "zero"] as const).includes(record.rbBuild as StrategyConfig["rbBuild"])) return null;
  const positionBudgets = numericRecord(record.positionBudgets, { nonnegative: true });
  const preferenceValues = preferenceRecord(record.preferences);
  const projectionOverrides = numericRecord(record.projectionOverrides);
  const valueOverrides = numericRecord(record.valueOverrides, { nonnegative: true });
  if (!positionBudgets || Object.keys(positionBudgets).length !== positions.length || !positions.every((position) => safeInteger(positionBudgets[position])) || !preferenceValues || !projectionOverrides || !valueOverrides || !Array.isArray(record.spendingCurve) || record.spendingCurve.length > SESSION_LIMITS.maxCurveEntries || !record.spendingCurve.every((entry) => finite(entry) && entry >= 0 && entry <= SESSION_LIMITS.maxNumber)) return null;
  return { id: record.id, name: record.name, archetype: record.archetype as StrategyConfig["archetype"], starterBudgetShare: record.starterBudgetShare, positionBudgets: positionBudgets as Record<Position, number>, spendingCurve: [...record.spendingCurve], qbApproach: record.qbApproach as StrategyConfig["qbApproach"], teApproach: record.teApproach as StrategyConfig["teApproach"], rbBuild: record.rbBuild as StrategyConfig["rbBuild"], minReserve: record.minReserve, preferences: preferenceValues, projectionOverrides, valueOverrides };
}

function purchase(
  value: unknown,
  source: DraftPurchase["source"],
  draftId: string,
): DraftPurchase | null {
  const record = object(value);
  if (!record || !onlyKeys(record, ["draftId", "playerId", "rosterId", "amount", "pickNo", "createdAt", "source", "keeper"]) || record.draftId !== draftId || !identifier(record.draftId) || !identifier(record.playerId) || !safeInteger(record.rosterId) || record.rosterId < 1 || !safeInteger(record.amount) || record.amount < 1 || record.amount > SESSION_LIMITS.maxNumber || !safeInteger(record.pickNo) || record.pickNo < 1 || record.pickNo > SESSION_LIMITS.maxNumber || record.source !== source || typeof record.keeper !== "boolean" || !(record.createdAt === null || date(record.createdAt))) return null;
  return record as unknown as DraftPurchase;
}

function projection(value: unknown): PlayerProjection | null {
  const record = object(value);
  const stats = object(record?.stats);
  if (!record || !stats || !onlyKeys(record, ["playerId", "name", "team", "positions", "stats", "source", "updatedAt"]) || !onlyKeys(stats, ["passYards", "passTds", "interceptions", "rushYards", "rushTds", "receptions", "receivingYards", "receivingTds", "fumblesLost"]) || !identifier(record.playerId) || !string(record.name) || !(record.team === null || string(record.team, 16)) || !Array.isArray(record.positions) || record.positions.length === 0 || record.positions.length > positions.length || !record.positions.every((position) => positions.includes(position as Position)) || !string(record.source) || !date(record.updatedAt) || !Object.values(stats).every((entry) => finite(entry) && Math.abs(entry) <= SESSION_LIMITS.maxNumber)) return null;
  return record as unknown as PlayerProjection;
}

function validateV1(value: unknown): StoredSessionV1 | null {
  const record = object(value);
  if (!record || !onlyKeys(record, ["version", "draftId", "strategy", "preferences", "localCorrections", "csvProjectionOverrides", "savedAt"]) || record.version !== 1 || !identifier(record.draftId) || !date(record.savedAt)) return null;
  const validStrategy = strategy(record.strategy);
  const preferenceValues = preferenceRecord(record.preferences);
  if (!validStrategy || !preferenceValues || !Array.isArray(record.localCorrections) || record.localCorrections.length > SESSION_LIMITS.maxCorrections || !Array.isArray(record.csvProjectionOverrides) || record.csvProjectionOverrides.length > SESSION_LIMITS.maxCsvProjections) return null;
  const localCorrections = record.localCorrections.map((item) => purchase(item, "local", record.draftId as string));
  const csvProjectionOverrides = record.csvProjectionOverrides.map(projection);
  if (localCorrections.some((item) => !item) || csvProjectionOverrides.some((item) => !item)) return null;
  return { version: 1, draftId: record.draftId, strategy: validStrategy, preferences: preferenceValues, localCorrections: localCorrections as DraftPurchase[], csvProjectionOverrides: csvProjectionOverrides as PlayerProjection[], savedAt: record.savedAt };
}

function migrate(value: unknown): StoredSessionV1 | null {
  const record = object(value);
  if (!record) return null;
  if (record.version === 1) return validateV1(record);
  if (record.version !== 0 || !identifier(record.draftId) || !date(record.savedAt)) return null;
  const validStrategy = strategy(record.strategy);
  return validStrategy ? { version: 1, draftId: record.draftId, strategy: validStrategy, preferences: {}, localCorrections: [], csvProjectionOverrides: [], savedAt: record.savedAt } : null;
}

function storage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

export function loadSession(draftId: string): StoredSessionV1 | null {
  if (!identifier(draftId)) return null;
  try {
    const raw = storage()?.getItem(sessionStorageKey(draftId));
    if (!raw || new TextEncoder().encode(raw).byteLength > SESSION_LIMITS.maxBytes) return null;
    const session = migrate(JSON.parse(raw));
    return session?.draftId === draftId ? session : null;
  } catch { return null; }
}

export type SessionSaveResult = { ok: true } | { ok: false; reason: "INVALID" | "TOO_LARGE" | "STORAGE" };

export function saveSession(session: StoredSessionV1): SessionSaveResult {
  const valid = validateV1(session);
  if (!valid) return { ok: false, reason: "INVALID" };
  try {
    const raw = JSON.stringify(valid);
    if (new TextEncoder().encode(raw).byteLength > SESSION_LIMITS.maxBytes) return { ok: false, reason: "TOO_LARGE" };
    const target = storage();
    if (!target) return { ok: false, reason: "STORAGE" };
    target.setItem(sessionStorageKey(valid.draftId), raw);
    return { ok: true };
  } catch { return { ok: false, reason: "STORAGE" }; }
}

export function clearSession(draftId: string): void {
  if (!identifier(draftId)) return;
  try { storage()?.removeItem(sessionStorageKey(draftId)); } catch { /* Browser storage is optional. */ }
}
