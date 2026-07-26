import {
  parsePublicSupabaseConfig,
  type PublicSupabaseConfig,
} from "@/integrations/supabase/config";
import { BrowserStrategyRepository } from "./browser-strategy-repository";
import type { SavedStrategyRepository } from "./saved-strategy-repository";
import {
  SupabaseStrategyRepository,
  type StrategySupabaseClient,
} from "./supabase-strategy-repository";

type SessionLike = { user: { id: string } } | null;

export async function selectStrategyRepository(
  rawConfig: Partial<PublicSupabaseConfig>,
  session: SessionLike,
  storage: Storage,
  createCloud: (
    client: StrategySupabaseClient,
    userId: string,
  ) => SavedStrategyRepository = (client, userId) =>
    new SupabaseStrategyRepository(client, userId),
): Promise<SavedStrategyRepository> {
  const config = parsePublicSupabaseConfig(rawConfig);
  if (!config || !session?.user?.id) return new BrowserStrategyRepository(storage);
  const { createSupabaseBrowserClient } = await import(
    "@/integrations/supabase/client"
  );
  const client = createSupabaseBrowserClient(config);
  return createCloud(client as unknown as StrategySupabaseClient, session.user.id);
}

export async function repositoryForCurrentSession(
  rawConfig: Partial<PublicSupabaseConfig>,
  storage: Storage,
): Promise<SavedStrategyRepository> {
  const config = parsePublicSupabaseConfig(rawConfig);
  if (!config) return new BrowserStrategyRepository(storage);
  try {
    const { createSupabaseBrowserClient } = await import(
      "@/integrations/supabase/client"
    );
    const client = createSupabaseBrowserClient(config);
    const { data } = await client.auth.getSession();
    if (!data.session?.user.id) return new BrowserStrategyRepository(storage);
    return new SupabaseStrategyRepository(
      client as unknown as StrategySupabaseClient,
      data.session.user.id,
    );
  } catch {
    return new BrowserStrategyRepository(storage);
  }
}
