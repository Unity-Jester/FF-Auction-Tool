import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const sourceUrl = "https://api.sleeper.app/v1/players/nfl";
const outputPath = path.resolve("data/sleeper/players.json");
const temporaryPath = `${outputPath}.tmp`;
const supportedPositions = ["QB", "RB", "WR", "TE", "K", "DEF"];
const supported = new Set(supportedPositions);
const minimumOffensivePlayers = 500;
const maximumBytes = 1_000_000;

function cleanText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePlayer(playerId, raw) {
  if (
    !raw ||
    typeof raw !== "object" ||
    raw.active === false ||
    raw.status === "Inactive"
  ) {
    return null;
  }
  const positions = [
    cleanText(raw.position),
    ...(Array.isArray(raw.fantasy_positions) ? raw.fantasy_positions : []),
  ].filter(
    (position, index, all) =>
      supported.has(position) && all.indexOf(position) === index,
  );
  const position = positions[0];
  if (!position) return null;

  const personName =
    cleanText(raw.full_name) ??
    [cleanText(raw.first_name), cleanText(raw.last_name)]
      .filter(Boolean)
      .join(" ");
  const name = personName || cleanText(raw.team);
  if (!name) return null;

  return {
    playerId: String(raw.player_id ?? playerId),
    name,
    team: cleanText(raw.team),
    position,
    positions,
    status: cleanText(raw.status),
    injuryStatus: cleanText(raw.injury_status),
  };
}

function normalizePlayerMap(playerMap) {
  if (!playerMap || typeof playerMap !== "object" || Array.isArray(playerMap)) {
    throw new Error("Sleeper player response must be an object map");
  }
  return Object.entries(playerMap)
    .map(([playerId, raw]) => normalizePlayer(playerId, raw))
    .filter(Boolean)
    .sort((a, b) =>
      a.playerId.localeCompare(b.playerId, undefined, { numeric: true }),
    );
}

function validateSnapshot(players) {
  if (!Array.isArray(players))
    throw new Error("Player snapshot must be an array");
  const offensiveCount = players.filter((player) =>
    ["QB", "RB", "WR", "TE"].includes(player.position),
  ).length;
  if (offensiveCount < minimumOffensivePlayers) {
    throw new Error(
      `Player snapshot has only ${offensiveCount} offensive players; expected at least ${minimumOffensivePlayers}`,
    );
  }
  for (let index = 0; index < players.length; index += 1) {
    const player = players[index];
    if (
      !player ||
      typeof player.playerId !== "string" ||
      typeof player.name !== "string" ||
      !supported.has(player.position) ||
      !Array.isArray(player.positions) ||
      player.positions.some((position) => !supported.has(position))
    ) {
      throw new Error(`Invalid compact player at index ${index}`);
    }
    if (
      index > 0 &&
      players[index - 1].playerId.localeCompare(player.playerId, undefined, {
        numeric: true,
      }) >= 0
    ) {
      throw new Error(
        "Player snapshot must be uniquely and deterministically sorted",
      );
    }
  }
  const serialized = `${JSON.stringify(players)}\n`;
  if (Buffer.byteLength(serialized) >= maximumBytes) {
    throw new Error(`Player snapshot exceeds ${maximumBytes} bytes`);
  }
  return serialized;
}

async function checkSnapshot() {
  const current = JSON.parse(await readFile(outputPath, "utf8"));
  const serialized = validateSnapshot(current);
  process.stdout.write(
    `Sleeper player snapshot valid: ${current.length} players, ${Buffer.byteLength(serialized)} bytes\n`,
  );
}

async function refreshSnapshot() {
  const response = await fetch(sourceUrl, { method: "GET" });
  if (!response.ok)
    throw new Error(
      `Sleeper player refresh failed with HTTP ${response.status}`,
    );
  const players = normalizePlayerMap(await response.json());
  const serialized = validateSnapshot(players);
  let previous = null;
  try {
    previous = await readFile(outputPath, "utf8");
  } catch {}
  if (previous === serialized) {
    process.stdout.write(
      `Sleeper player snapshot unchanged: ${players.length} players, ${Buffer.byteLength(serialized)} bytes\n`,
    );
    return;
  }
  await writeFile(temporaryPath, serialized, "utf8");
  try {
    await rename(temporaryPath, outputPath);
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
  process.stdout.write(
    `Sleeper player snapshot refreshed: ${players.length} players, ${Buffer.byteLength(serialized)} bytes\n`,
  );
}

if (process.argv.includes("--check")) await checkSnapshot();
else await refreshSnapshot();
