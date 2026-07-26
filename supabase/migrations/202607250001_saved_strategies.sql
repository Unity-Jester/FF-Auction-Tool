create table if not exists public.saved_strategies (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  strategy jsonb not null check (octet_length(strategy::text) <= 32768),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists saved_strategies_user_id_idx
  on public.saved_strategies(user_id);

alter table public.saved_strategies enable row level security;
alter table public.saved_strategies force row level security;

revoke all on public.saved_strategies from public;
revoke all on public.saved_strategies from anon;
grant select, insert, update, delete on public.saved_strategies to authenticated;

drop policy if exists "owners select saved strategies" on public.saved_strategies;
create policy "owners select saved strategies"
  on public.saved_strategies for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "owners insert saved strategies" on public.saved_strategies;
create policy "owners insert saved strategies"
  on public.saved_strategies for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "owners update saved strategies" on public.saved_strategies;
create policy "owners update saved strategies"
  on public.saved_strategies for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "owners delete saved strategies" on public.saved_strategies;
create policy "owners delete saved strategies"
  on public.saved_strategies for delete to authenticated
  using (auth.uid() = user_id);

create or replace function public.protect_saved_strategy_owner()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'saved strategy owner cannot be changed';
  end if;
  return new;
end;
$$;

create or replace function public.set_saved_strategy_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists protect_saved_strategy_owner on public.saved_strategies;
create trigger protect_saved_strategy_owner
before update on public.saved_strategies
for each row execute function public.protect_saved_strategy_owner();

drop trigger if exists set_saved_strategy_updated_at on public.saved_strategies;
create trigger set_saved_strategy_updated_at
before update on public.saved_strategies
for each row execute function public.set_saved_strategy_updated_at();

revoke all on function public.protect_saved_strategy_owner() from public, anon, authenticated;
revoke all on function public.set_saved_strategy_updated_at() from public, anon, authenticated;
