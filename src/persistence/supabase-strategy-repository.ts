import {
  parseSavedStrategy,
  type SavedStrategy,
  type SavedStrategyRepository,
} from "./saved-strategy-repository";

type QueryResult = PromiseLike<{
  data: unknown;
  error: { code?: string; message?: string } | null;
}>;

type StrategyQuery = QueryResult & {
  select(columns: string): StrategyQuery;
  eq(column: string, value: string): StrategyQuery;
  order(column: string, options: { ascending: boolean }): QueryResult;
  upsert(value: Record<string, unknown>): QueryResult;
  delete(): StrategyQuery;
};

export type StrategySupabaseClient = {
  from(table: "saved_strategies"): StrategyQuery;
  rpc(
    fn: "save_strategy",
    args: { p_id: string; p_name: string; p_strategy: unknown },
  ): QueryResult;
};

function fromDatabaseRow(row: unknown): SavedStrategy {
  if (!row || typeof row !== "object") {
    throw new Error("Saved strategies could not be read safely.");
  }
  const value = row as Record<string, unknown>;
  try {
    return parseSavedStrategy({
      id: value.id,
      name: value.name,
      strategy: value.strategy,
      createdAt: value.created_at,
      updatedAt: value.updated_at,
    });
  } catch {
    throw new Error("Saved strategies could not be read safely.");
  }
}

export class SupabaseStrategyRepository implements SavedStrategyRepository {
  private warnings: string[] = [];

  constructor(
    private readonly client: StrategySupabaseClient,
    private readonly userId: string,
  ) {}

  async list(): Promise<SavedStrategy[]> {
    const { data, error } = await this.client
      .from("saved_strategies")
      .select("id,name,strategy,created_at,updated_at")
      .eq("user_id", this.userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error("Saved strategies could not be loaded.");
    if (!Array.isArray(data)) {
      throw new Error("Saved strategies could not be read safely.");
    }
    const records: SavedStrategy[] = [];
    let invalid = false;
    for (const row of data) {
      try {
        records.push(fromDatabaseRow(row));
      } catch {
        invalid = true;
      }
    }
    this.warnings = invalid
      ? ["Some cloud strategies were skipped because they were invalid."]
      : [];
    return records;
  }

  async save(value: SavedStrategy): Promise<void> {
    const strategy = parseSavedStrategy(value);
    const { error } = await this.client.rpc("save_strategy", {
      p_id: strategy.id,
      p_name: strategy.name,
      p_strategy: strategy.strategy,
    });
    if (error) {
      if (
        error.code === "P0001" &&
        error.message === "saved_strategy_quota_exceeded"
      ) {
        throw new Error("You can save up to 50 named strategies.");
      }
      throw new Error("The strategy could not be saved.");
    }
  }

  async remove(id: string): Promise<void> {
    if (!id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
      throw new Error("The saved strategy identifier is not valid.");
    }
    const { error } = await this.client
      .from("saved_strategies")
      .delete()
      .eq("id", id);
    if (error) throw new Error("The strategy could not be removed.");
  }

  getWarnings(): string[] {
    return [...this.warnings];
  }
}
