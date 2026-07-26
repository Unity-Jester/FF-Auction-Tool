import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const season = new Date().getUTCFullYear();
const source = "Sleeper season projections";
const sourceUrl = `https://api.sleeper.com/projections/nfl/${season}?season_type=regular`;
const outputPath = path.resolve("data/projections/last-known.json");
const tempPath = `${outputPath}.tmp`;
const maximumResponseBytes = 12 * 1024 * 1024;
const requestTimeoutMs = 15_000;
const positions = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
const statMap = { pass_yd: "passYards", pass_td: "passTds", pass_int: "interceptions", rush_yd: "rushYards", rush_td: "rushTds", rec: "receptions", rec_yd: "receivingYards", rec_td: "receivingTds", fum_lost: "fumblesLost" };
const supportedStats = new Set(Object.values(statMap));

function text(value) { return typeof value === "string" && value.trim() && value.length <= 160 ? value.trim() : null; }
function position(value) { const valueUpper = text(value)?.toUpperCase(); return valueUpper === "D/ST" || valueUpper === "DST" || valueUpper === "DEFENSE" ? "DEF" : positions.has(valueUpper) ? valueUpper : null; }
function number(value) { return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 100000 ? value : undefined; }
function sourceTimestamp(raw) {
  const upperBound = Date.now() + 2 * 365 * 24 * 60 * 60 * 1000;
  for (const candidate of [raw.updated_at, raw.last_modified]) { const value = Number(candidate); if (Number.isFinite(value) && value >= Date.UTC(2000, 0, 1) && value <= upperBound) return value; }
  return null;
}
function normalize(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (raw.season !== undefined && String(raw.season) !== String(season)) return null;
  if (raw.season_type !== undefined && raw.season_type !== "regular") return null;
  const sourceUpdatedAt = sourceTimestamp(raw);
  if (sourceUpdatedAt === null) return null;
  const player = raw.player && typeof raw.player === "object" && !Array.isArray(raw.player) ? raw.player : raw;
  const playerId = text(raw.player_id ?? player.player_id);
  const constructedName = [text(player.first_name), text(player.last_name)].filter(Boolean).join(" ");
  const name = (text(player.full_name) ?? constructedName) || text(player.team) || text(raw.team);
  const playerPositions = [player.position, ...(Array.isArray(player.fantasy_positions) ? player.fantasy_positions : [])].map(position).filter(Boolean).filter((item, index, all) => all.indexOf(item) === index);
  if (!playerId || !name || !playerPositions.length) return null;
  const stats = {};
  const rawStats = raw.stats && typeof raw.stats === "object" && !Array.isArray(raw.stats) ? raw.stats : {};
  for (const [key, destination] of Object.entries(statMap)) { const value = number(rawStats[key]); if (value !== undefined) stats[destination] = value; }
  if (!Object.keys(stats).length) return null;
  return { playerId, name, team: text(player.team) ?? text(raw.team), positions: playerPositions, stats, sourceUpdatedAt };
}
function validate(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.projections) || !text(snapshot.source) || !Number.isFinite(Date.parse(snapshot.updatedAt))) throw new Error("Invalid projection snapshot");
  const ids = new Set(); let offense = 0;
  for (const projection of snapshot.projections) { const statEntries = projection?.stats && typeof projection.stats === "object" ? Object.entries(projection.stats) : []; if (!text(projection?.playerId) || !text(projection?.name) || !Array.isArray(projection.positions) || !projection.positions.length || !statEntries.length || statEntries.some(([name, value]) => !supportedStats.has(name) || typeof value !== "number" || !Number.isFinite(value)) || ids.has(projection.playerId)) throw new Error("Invalid projection record"); ids.add(projection.playerId); if (projection.positions.some((item) => ["QB", "RB", "WR", "TE"].includes(item))) offense++; }
  if (offense < 100) throw new Error(`Projection snapshot has only ${offense} offensive players`);
  return `${JSON.stringify(snapshot)}\n`;
}
async function check() { const snapshot = JSON.parse(await readFile(outputPath, "utf8")); const serialized = validate(snapshot); process.stdout.write(`Projection snapshot valid: ${snapshot.projections.length} players, ${Buffer.byteLength(serialized)} bytes\n`); }
async function readBoundedJson(response) {
  if (!response.ok) throw new Error(`Sleeper projection refresh failed with HTTP ${response.status}`);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumResponseBytes) throw new Error(`Sleeper projection response exceeds ${maximumResponseBytes} bytes`);
  if (!response.body) throw new Error("Sleeper projection response has no body");
  const reader = response.body.getReader(); const chunks = []; let total = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > maximumResponseBytes) { await reader.cancel(); throw new Error(`Sleeper projection response exceeds ${maximumResponseBytes} bytes`); } chunks.push(value); }
  const bytes = Buffer.allocUnsafe(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(bytes.toString("utf8"));
}
async function refresh() {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), requestTimeoutMs); let raw;
  try { raw = await readBoundedJson(await fetch(sourceUrl, { signal: controller.signal })); } finally { clearTimeout(timeout); }
  if (!Array.isArray(raw)) throw new Error("Sleeper projection response must be an array");
  const unique = new Map(); for (const row of raw) { const projection = normalize(row); if (projection && !unique.has(projection.playerId)) unique.set(projection.playerId, projection); }
  const accepted = [...unique.values()]; if (!accepted.length) throw new Error("Sleeper projection response has no usable projections");
  const updatedAt = new Date(Math.max(...accepted.map((projection) => projection.sourceUpdatedAt))).toISOString();
  const projections = accepted.map((projection) => ({ playerId: projection.playerId, name: projection.name, team: projection.team, positions: projection.positions, stats: projection.stats, source, updatedAt })).sort((a, b) => a.playerId.localeCompare(b.playerId, undefined, { numeric: true }));
  const snapshot = { source, updatedAt, projections }; const serialized = validate(snapshot);
  let old = null; try { old = await readFile(outputPath, "utf8"); } catch {}
  if (old === serialized) { process.stdout.write(`Projection snapshot unchanged: ${snapshot.projections.length} players\n`); return; }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(tempPath, serialized); try { await rename(tempPath, outputPath); } finally { await unlink(tempPath).catch(() => {}); }
  process.stdout.write(`Projection snapshot refreshed: ${snapshot.projections.length} players\n`);
}
if (process.argv.includes("--check")) await check(); else await refresh();
