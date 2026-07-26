import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/202607250001_saved_strategies.sql"),
  "utf8",
).toLowerCase();

describe("saved strategies migration", () => {
  it("enforces ownership, bounds, immutable owners, and least privilege", () => {
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("force row level security");
    expect(sql).toContain("auth.uid() = user_id");
    expect(sql).toContain("char_length(name) between 1 and 80");
    expect(sql).toContain("octet_length(strategy::text) <= 32768");
    expect(sql).toContain("revoke all on public.saved_strategies from anon");
    expect(sql).toContain("grant select, delete on public.saved_strategies to authenticated");
    expect(sql).not.toContain("grant select, insert, update, delete on public.saved_strategies to authenticated");
    expect(sql).toContain("new.user_id is distinct from old.user_id");
    expect(sql).toContain("create or replace function public.set_saved_strategy_updated_at");
  });

  it("serializes a strict per-user quota and lets the database own timestamps", () => {
    expect(sql).toContain("create or replace function public.save_strategy");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("saved_strategy_quota_exceeded");
    expect(sql).toMatch(/select count\(\*\)[\s\S]+where user_id = v_user_id[\s\S]+\) >= 50/);
    expect(sql).toContain("if exists");
    expect(sql).toContain("update public.saved_strategies");
    expect(sql).toContain("set name = p_name, strategy = p_strategy");
    expect(sql.indexOf("if exists")).toBeLessThan(sql.indexOf("select count(*)"));
    expect(sql).not.toContain("created_at =");
    expect(sql).toContain("revoke all on function public.save_strategy");
    expect(sql).toContain("grant execute on function public.save_strategy");
  });
});
