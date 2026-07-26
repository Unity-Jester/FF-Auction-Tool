import {
  parseSavedStrategy,
  type SavedStrategy,
  type SavedStrategyRepository,
} from "./saved-strategy-repository";

type QueryResult = PromiseLike<{
  data: unknown;
  error: { message?: string } | null;
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
    return data.map(fromDatabaseRow);
  }

  async save(value: SavedStrategy): Promise<void> {
    const strategy = parseSavedStrategy(value);
    const { error } = await this.client.from("saved_strategies").upsert({
      id: strategy.id,
      user_id: this.userId,
      name: strategy.name,
      strategy: strategy.strategy,
      created_at: strategy.createdAt,
      updated_at: strategy.updatedAt,
    });
    if (error) throw new Error("The strategy could not be saved.");
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
}
