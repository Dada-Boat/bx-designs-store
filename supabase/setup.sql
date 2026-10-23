-- BX Designs design library: run in your Supabase project (SQL Editor > New query > Run). Safe to
-- run again after an update: it only adds what's missing and replaces the rules.
-- Designers sign in by email; each one's files live under designs/<their user id>/ in Storage.
-- Row Level Security makes the database itself enforce who sees what: a designer sees and
-- changes only their own designs, and everyone may see the ones a designer chose to share or
-- published as a template (unless BuildX Multimedia hid it).

-- The designs table ---------------------------------------------------------------------------
create table if not exists public.designs (
  id            uuid primary key default gen_random_uuid(),
  owner         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 120),
  designer_name text check (designer_name is null or char_length(designer_name) <= 60),
  file_path     text not null unique,
  preview_path  text,
  file_name     text not null check (char_length(file_name) <= 200),
  size          bigint not null check (size > 0 and size <= 52428800),
  shared        boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Templates: a design its owner published to the template store, in a category, with a preview.
-- `price_cents` (0 = free) and `hidden` (taken down) are set by BuildX Multimedia in the
-- dashboard; designers can't change them.
alter table public.designs add column if not exists is_template boolean not null default false;
alter table public.designs add column if not exists category text;
alter table public.designs add column if not exists price_cents integer not null default 0;
alter table public.designs add column if not exists hidden boolean not null default false;
alter table public.designs drop constraint if exists designs_category_length;
alter table public.designs add constraint designs_category_length check (category is null or char_length(category) <= 40);
alter table public.designs drop constraint if exists designs_price_nonnegative;
alter table public.designs add constraint designs_price_nonnegative check (price_cents >= 0);
alter table public.designs drop constraint if exists designs_template_complete;
alter table public.designs add constraint designs_template_complete check (not is_template or (preview_path is not null and category is not null));

create index if not exists designs_owner_created on public.designs (owner, created_at desc);
create index if not exists designs_templates_created on public.designs (created_at desc) where is_template and not hidden;
create index if not exists designs_shared_created on public.designs (created_at desc) where shared;

alter table public.designs enable row level security;

-- Let the site's API reach the table (projects can be set not to expose new tables); the policies
-- below still decide which rows each visitor may see or change.
grant select on public.designs to anon;
grant select, insert, update, delete on public.designs to authenticated;

drop policy if exists "read own or shared designs" on public.designs;
create policy "read own or shared designs" on public.designs
  for select using (((shared or is_template) and not hidden) or owner = auth.uid());

drop policy if exists "add own designs" on public.designs;
create policy "add own designs" on public.designs
  for insert to authenticated with check (
    owner = auth.uid()
    and file_path like auth.uid()::text || '/%'
    and (preview_path is null or preview_path like auth.uid()::text || '/%')
  );

drop policy if exists "change own designs" on public.designs;
create policy "change own designs" on public.designs
  for update to authenticated using (owner = auth.uid()) with check (
    owner = auth.uid() and (preview_path is null or preview_path like auth.uid()::text || '/%')
  );

drop policy if exists "delete own designs" on public.designs;
create policy "delete own designs" on public.designs
  for delete to authenticated using (owner = auth.uid());

-- After upload a designer may change the title, name, sharing and template settings, and add a
-- preview to a design that has none; not the owner or the files. Price and hidden are only set in
-- the dashboard (which doesn't run as a site visitor).
create or replace function public.designs_keep_files() returns trigger language plpgsql as $$
begin
  new.owner := old.owner;
  new.file_path := old.file_path;
  if old.preview_path is not null then
    new.preview_path := old.preview_path;
  end if;
  new.file_name := old.file_name;
  new.size := old.size;
  new.created_at := old.created_at;
  if current_user in ('anon', 'authenticated') then
    new.price_cents := old.price_cents;
    new.hidden := old.hidden;
  end if;
  return new;
end $$;
drop trigger if exists designs_keep_files on public.designs;
create trigger designs_keep_files before update on public.designs
  for each row execute function public.designs_keep_files();

-- New designs start free and visible, whatever the site sends.
create or replace function public.designs_new_defaults() returns trigger language plpgsql as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.price_cents := 0;
    new.hidden := false;
  end if;
  return new;
end $$;
drop trigger if exists designs_new_defaults on public.designs;
create trigger designs_new_defaults before insert on public.designs
  for each row execute function public.designs_new_defaults();

-- The storage bucket ----------------------------------------------------------------------------
-- Private: files are reached through short-lived signed links the site asks for. 50 MB per file.
insert into storage.buckets (id, name, public, file_size_limit)
values ('designs', 'designs', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists "upload into own folder" on storage.objects;
create policy "upload into own folder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'designs' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "read own or shared files" on storage.objects;
create policy "read own or shared files" on storage.objects
  for select using (
    bucket_id = 'designs' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.designs d
        where (d.shared or d.is_template) and not d.hidden
          and (d.file_path = storage.objects.name or d.preview_path = storage.objects.name)
      )
    )
  );

drop policy if exists "delete own files" on storage.objects;
create policy "delete own files" on storage.objects
  for delete to authenticated using (
    bucket_id = 'designs' and (storage.foldername(name))[1] = auth.uid()::text
  );
