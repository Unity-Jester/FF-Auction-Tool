import {
  parseSavedStrategy,
  type SavedStrategy,
  type SavedStrategyRepository,
} from "./saved-strategy-repository";

const STORAGE_KEY = "sleeper-auction-companion:saved-strategies:v1";
const LOCK_NAME = "sleeper-auction-companion:saved-strategies";
const FALLBACK_LOCK_PREFIX = `${LOCK_NAME}:lock:`;
const LOCK_TIMEOUT_MS = 2_000;
const FALLBACK_LOCK_LEASE_MS = 5_000;
const FALLBACK_LOCK_POLL_MS = 20;
const mutationQueues = new WeakMap<Storage, Promise<void>>();
const unavailableStorage: Storage = {
  length: 0,
  clear: () => { throw new DOMException("Storage unavailable"); },
  getItem: () => { throw new DOMException("Storage unavailable"); },
  key: () => null,
  removeItem: () => { throw new DOMException("Storage unavailable"); },
  setItem: () => { throw new DOMException("Storage unavailable"); },
};

export function browserStrategyStorage(): Storage {
  try {
    return window.localStorage;
  } catch {
    return unavailableStorage;
  }
}

type FallbackLockClaim = {
  owner: string;
  choosing: boolean;
  ticket: number;
  expiresAt: number;
};

function fallbackOwner(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random()}`;
  }
}

function fallbackClaims(storage: Storage, now: number): FallbackLockClaim[] {
  const keys = Array.from(
    { length: storage.length },
    (_, index) => storage.key(index),
  ).filter((key): key is string => key?.startsWith(FALLBACK_LOCK_PREFIX) ?? false);
  const claims: FallbackLockClaim[] = [];
  for (const key of keys) {
    try {
      const claim = JSON.parse(storage.getItem(key) ?? "") as FallbackLockClaim;
      if (
        typeof claim.owner !== "string" ||
        typeof claim.choosing !== "boolean" ||
        !Number.isSafeInteger(claim.ticket) ||
        claim.ticket < 0 ||
        !Number.isFinite(claim.expiresAt)
      ) {
        storage.removeItem(key);
      } else if (claim.expiresAt <= now) {
        storage.removeItem(key);
      } else {
        claims.push(claim);
      }
    } catch {
      storage.removeItem(key);
    }
  }
  return claims;
}

function writeFallbackClaim(
  storage: Storage,
  key: string,
  claim: Omit<FallbackLockClaim, "expiresAt">,
): void {
  storage.setItem(
    key,
    JSON.stringify({
      ...claim,
      expiresAt: Date.now() + FALLBACK_LOCK_LEASE_MS,
    }),
  );
}

function waitForFallbackPoll(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, FALLBACK_LOCK_POLL_MS);
  });
}

async function withCrossTabFallback<T>(
  storage: Storage,
  operation: () => Promise<T>,
): Promise<T> {
  const owner = fallbackOwner();
  const key = `${FALLBACK_LOCK_PREFIX}${owner}`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let ticket = 0;
  try {
    writeFallbackClaim(storage, key, { owner, choosing: true, ticket });
    const claims = fallbackClaims(storage, Date.now());
    ticket = claims.reduce(
      (highest, claim) => Math.max(highest, claim.ticket),
      0,
    ) + 1;
    writeFallbackClaim(storage, key, { owner, choosing: false, ticket });

    while (true) {
      writeFallbackClaim(storage, key, { owner, choosing: false, ticket });
      const blocker = fallbackClaims(storage, Date.now()).some((claim) => {
        if (claim.owner === owner) return false;
        if (claim.choosing) return true;
        return claim.ticket < ticket ||
          (claim.ticket === ticket && claim.owner < owner);
      });
      if (!blocker) return await operation();
      if (Date.now() >= deadline) {
        throw new Error("Saved strategies are busy in another tab.");
      }
      await waitForFallbackPoll();
    }
  } finally {
    storage.removeItem(key);
  }
}

async function withInProcessLock<T>(
  storage: Storage,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = mutationQueues.get(storage) ?? Promise.resolve();
  let release = () => {};
  const complete = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => complete);
  mutationQueues.set(storage, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (mutationQueues.get(storage) === tail) mutationQueues.delete(storage);
  }
}

async function withMutationLock<T>(
  storage: Storage,
  operation: () => Promise<T>,
): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) {
    return withInProcessLock(
      storage,
      () => withCrossTabFallback(storage, operation),
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOCK_TIMEOUT_MS);
  try {
    return await locks.request(
      LOCK_NAME,
      { mode: "exclusive", signal: controller.signal },
      operation,
    );
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Saved strategies are busy in another tab. Please try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export class BrowserStrategyRepository implements SavedStrategyRepository {
  constructor(private readonly storage: Storage) {}

  private read(): SavedStrategy[] {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const value: unknown = JSON.parse(raw);
      if (!Array.isArray(value)) return [];
      const records: SavedStrategy[] = [];
      for (const item of value) {
        try {
          records.push(parseSavedStrategy(item));
        } catch {
          // A corrupt entry must not disable guest mode.
        }
      }
      return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch {
      return [];
    }
  }

  async list(): Promise<SavedStrategy[]> {
    return this.read();
  }

  async save(value: SavedStrategy): Promise<void> {
    const strategy = parseSavedStrategy(value);
    try {
      await withMutationLock(this.storage, async () => {
        const records = [
          strategy,
          ...this.read().filter((item) => item.id !== strategy.id),
        ];
        this.storage.setItem(STORAGE_KEY, JSON.stringify(records));
      });
    } catch {
      throw new Error("This browser could not save the strategy.");
    }
  }

  async remove(id: string): Promise<void> {
    if (!id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
      throw new Error("The saved strategy identifier is not valid.");
    }
    try {
      await withMutationLock(this.storage, async () => {
        const records = this.read().filter((item) => item.id !== id);
        this.storage.setItem(STORAGE_KEY, JSON.stringify(records));
      });
    } catch {
      throw new Error("This browser could not remove the strategy.");
    }
  }
}
