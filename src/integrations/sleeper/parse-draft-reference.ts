const DRAFT_ID = /^\d{10,24}$/;

export function parseDraftReference(reference: string): string {
  const value = reference.trim();
  if (DRAFT_ID.test(value)) return value;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid Sleeper draft");
  }

  if (
    url.protocol !== "https:" ||
    (url.hostname !== "sleeper.com" && url.hostname !== "sleeper.app")
  ) {
    throw new Error("Invalid Sleeper draft");
  }

  const match = url.pathname.match(/^\/draft\/nfl\/(\d{10,24})\/?$/);
  if (!match) throw new Error("Invalid Sleeper draft");
  return match[1];
}

