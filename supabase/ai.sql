-- BX Designs AI credits: run in your Supabase project (SQL Editor > New query > Run). Safe to run again.
-- Each designer starts with 10 credits (the balance's default); one Generative Fill costs one. Designers can read
-- their own balance but never change it: only the generative-fill function (running with the
-- service role) spends or refunds credits, through the functions below.

create table if not exists public.ai_credits (
  owner      uuid primary key references auth.users (id) on delete cascade,
  balance    integer not null default 10 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_usage (
  id         bigint generated always as identity primary key,
  owner      uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (char_length(kind) <= 40),
  credits    integer not null,
  status     text not null default 'started' check (status in ('started', 'done', 'refunded')),
  detail     text check (detail is null or char_length(detail) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_owner_created on public.ai_usage (owner, created_at desc);

alter table public.ai_credits enable row level security;
alter table public.ai_usage enable row level security;
grant select on public.ai_credits to authenticated;
grant select on public.ai_usage to authenticated;

drop policy if exists "read own credits" on public.ai_credits;
create policy "read own credits" on public.ai_credits for select to authenticated using (owner = auth.uid());
drop policy if exists "read own usage" on public.ai_usage;
create policy "read own usage" on public.ai_usage for select to authenticated using (owner = auth.uid());

-- Spend `cost` credits for `who` (creating their starting balance on first use). Returns the
-- usage row id, or raises 'no credits'. Only the service role may call it.
create or replace function public.ai_spend(who uuid, kind text, cost integer)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  usage_id bigint;
begin
  insert into ai_credits (owner) values (who) on conflict (owner) do nothing;
  update ai_credits set balance = balance - cost, updated_at = now()
    where owner = who and balance >= cost;
  if not found then
    raise exception 'no credits';
  end if;
  insert into ai_usage (owner, kind, credits) values (who, kind, cost) returning id into usage_id;
  return usage_id;
end $$;

-- Close a usage row: 'done', or 'refunded' (the credits go back).
create or replace function public.ai_finish(usage_id bigint, ok boolean, note text)
returns void language plpgsql security definer set search_path = public as $$
declare
  u ai_usage%rowtype;
begin
  select * into u from ai_usage where id = usage_id and status = 'started' for update;
  if not found then
    return;
  end if;
  if ok then
    update ai_usage set status = 'done', detail = left(note, 500) where id = usage_id;
  else
    update ai_usage set status = 'refunded', detail = left(note, 500) where id = usage_id;
    update ai_credits set balance = balance + u.credits, updated_at = now() where owner = u.owner;
  end if;
end $$;

revoke all on function public.ai_spend(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.ai_finish(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.ai_spend(uuid, text, integer) to service_role;
grant execute on function public.ai_finish(bigint, boolean, text) to service_role;
