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
revoke insert, update on public.saved_strategies from authenticated;
grant select, delete on public.saved_strategies to authenticated;

drop policy if exists "owners select saved strategies" on public.saved_strategies;
create policy "owners select saved strategies"
  on public.saved_strategies for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "owners insert saved strategies" on public.saved_strategies;
drop policy if exists "owners update saved strategies" on public.saved_strategies;

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
  if new.created_at is distinct from old.created_at then
    raise exception 'saved strategy creation time cannot be changed';
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

create or replace function public.save_strategy(
  p_id uuid,
  p_name text,
  p_strategy jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'saved_strategy_auth_required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  if exists (
    select 1
    from public.saved_strategies
    where id = p_id and user_id = v_user_id
  ) then
    update public.saved_strategies
    set name = p_name, strategy = p_strategy
    where id = p_id and user_id = v_user_id;
  else
    if (
      select count(*)
      from public.saved_strategies
      where user_id = v_user_id
    ) >= 50 then
      raise exception using
        errcode = 'P0001',
        message = 'saved_strategy_quota_exceeded';
    end if;

    insert into public.saved_strategies (id, user_id, name, strategy)
    values (p_id, v_user_id, p_name, p_strategy);
  end if;
end;
$$;

revoke all on function public.save_strategy(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_strategy(uuid, text, jsonb)
  to authenticated;
