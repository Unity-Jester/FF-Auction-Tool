import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const season = new Date().getUTCFullYear();
const source = "Sleeper season projections";
const sourceUrl = `https://api.sleeper.com/projections/nfl/${season}?season_type=regular`;
const outputPath = path.resolve("data/projections/last-known.json");
const tempPath = `${outputPath}.tmp`;
const positions = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
const statMap = { pass_yd: "passYards", pass_td: "passTds", pass_int: "interceptions", rush_yd: "rushYards", rush_td: "rushTds", rec: "receptions", rec_yd: "receivingYards", rec_td: "receivingTds", fum_lost: "fumblesLost" };

function text(value) { return typeof value === "string" && value.trim() && value.length <= 160 ? value.trim() : null; }
function position(value) { const valueUpper = text(value)?.toUpperCase(); return valueUpper === "D/ST" || valueUpper === "DST" || valueUpper === "DEFENSE" ? "DEF" : positions.has(valueUpper) ? valueUpper : null; }
function number(value) { return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 100000 ? value : undefined; }
function normalize(raw, updatedAt) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const player = raw.player && typeof raw.player === "object" && !Array.isArray(raw.player) ? raw.player : raw;
  const playerId = text(raw.player_id ?? player.player_id);
  const constructedName = [text(player.first_name), text(player.last_name)].filter(Boolean).join(" ");
  const name = (text(player.full_name) ?? constructedName) || text(player.team) || text(raw.team);
  const playerPositions = [player.position, ...(Array.isArray(player.fantasy_positions) ? player.fantasy_positions : [])].map(position).filter(Boolean).filter((item, index, all) => all.indexOf(item) === index);
  if (!playerId || !name || !playerPositions.length) return null;
  const stats = {};
  const rawStats = raw.stats && typeof raw.stats === "object" && !Array.isArray(raw.stats) ? raw.stats : {};
  for (const [key, destination] of Object.entries(statMap)) { const value = number(rawStats[key]); if (value !== undefined) stats[destination] = value; }
  return { playerId, name, team: text(player.team) ?? text(raw.team), positions: playerPositions, stats, source, updatedAt };
}
function validate(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.projections) || !text(snapshot.source) || !Number.isFinite(Date.parse(snapshot.updatedAt))) throw new Error("Invalid projection snapshot");
  const ids = new Set(); let offense = 0;
  for (const projection of snapshot.projections) { if (!text(projection.playerId) || !text(projection.name) || !Array.isArray(projection.positions) || !projection.positions.length || !projection.stats || typeof projection.stats !== "object" || ids.has(projection.playerId)) throw new Error("Invalid projection record"); ids.add(projection.playerId); if (projection.positions.some((item) => ["QB", "RB", "WR", "TE"].includes(item))) offense++; }
  if (offense < 100) throw new Error(`Projection snapshot has only ${offense} offensive players`);
  return `${JSON.stringify(snapshot)}\n`;
}
async function check() { const snapshot = JSON.parse(await readFile(outputPath, "utf8")); const serialized = validate(snapshot); process.stdout.write(`Projection snapshot valid: ${snapshot.projections.length} players, ${Buffer.byteLength(serialized)} bytes\n`); }
async function refresh() {
  const response = await fetch(sourceUrl); if (!response.ok) throw new Error(`Sleeper projection refresh failed with HTTP ${response.status}`);
  const raw = await response.json(); if (!Array.isArray(raw)) throw new Error("Sleeper projection response must be an array");
  const latestSourceUpdate = Math.max(...raw.map((row) => Number(row?.updated_at ?? row?.last_modified)).filter(Number.isFinite));
  const updatedAt = Number.isFinite(latestSourceUpdate) ? new Date(latestSourceUpdate).toISOString() : new Date().toISOString(); const unique = new Map(); for (const row of raw) { const projection = normalize(row, updatedAt); if (projection && !unique.has(projection.playerId)) unique.set(projection.playerId, projection); }
  const snapshot = { source, updatedAt, projections: [...unique.values()].sort((a, b) => a.playerId.localeCompare(b.playerId, undefined, { numeric: true })) }; const serialized = validate(snapshot);
  let old = null; try { old = await readFile(outputPath, "utf8"); } catch {}
  if (old === serialized) { process.stdout.write(`Projection snapshot unchanged: ${snapshot.projections.length} players\n`); return; }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(tempPath, serialized); try { await rename(tempPath, outputPath); } finally { await unlink(tempPath).catch(() => {}); }
  process.stdout.write(`Projection snapshot refreshed: ${snapshot.projections.length} players\n`);
}
if (process.argv.includes("--check")) await check(); else await refresh();
