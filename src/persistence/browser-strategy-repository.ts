import {
  parseSavedStrategy,
  type SavedStrategy,
  type SavedStrategyRepository,
} from "./saved-strategy-repository";

const STORAGE_KEY = "sleeper-auction-companion:saved-strategies:v1";
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

export class BrowserStrategyRepository implements SavedStrategyRepository {
  constructor(private readonly storage: Storage) {}

  async list(): Promise<SavedStrategy[]> {
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

  async save(value: SavedStrategy): Promise<void> {
    const strategy = parseSavedStrategy(value);
    const records = [
      strategy,
      ...(await this.list()).filter((item) => item.id !== strategy.id),
    ];
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch {
      throw new Error("This browser could not save the strategy.");
    }
  }

  async remove(id: string): Promise<void> {
    if (!id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
      throw new Error("The saved strategy identifier is not valid.");
    }
    try {
      const records = (await this.list()).filter((item) => item.id !== id);
      this.storage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch {
      throw new Error("This browser could not remove the strategy.");
    }
  }
}
