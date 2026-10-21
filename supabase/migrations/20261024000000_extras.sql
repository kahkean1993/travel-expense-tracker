-- Per-category budgets (and, below, receipt photos).
--
-- Run this once in the Supabase SQL Editor, AFTER the three earlier files.

-- ---------------------------------------------------------------------
-- Budget per category: { "<category id>": <minor units>, ... }
-- ---------------------------------------------------------------------

alter table public.trips
  add column category_budgets jsonb not null default '{}'::jsonb
  check (jsonb_typeof(category_budgets) = 'object' and pg_column_size(category_budgets) <= 8192);

-- ---------------------------------------------------------------------
-- Settlement payments made in another currency
-- ---------------------------------------------------------------------

alter table public.settlements
  add column original_amount_minor bigint check (original_amount_minor between 1 and 1000000000000000),
  add column original_currency text check (original_currency ~ '^[A-Z]{3}$'),
  add column exchange_rate text check (char_length(exchange_rate) <= 24),
  add check ((original_amount_minor is null) = (original_currency is null)
         and (original_currency is null) = (exchange_rate is null));

-- ---------------------------------------------------------------------
-- Receipt photos
-- The photo files live in a private Storage bucket, one folder per trip
-- ("<trip id>/<receipt id>"). This table says which photos belong to which
-- expense, so every phone knows what to download.
-- ---------------------------------------------------------------------

create table public.receipts (
  id uuid primary key,
  trip_id uuid not null references public.trips (id) on delete cascade,
  expense_id uuid not null references public.expenses (id),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 2097152),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  created_by uuid default auth.uid(),
  deleted_at timestamptz
);
create index receipts_trip_id_updated_at_idx on public.receipts (trip_id, updated_at);
create index receipts_expense_id_idx on public.receipts (expense_id);

-- The expense must be on the same trip, and an expense keeps at most 3 photos.
create function private.guard_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.expenses e where e.id = new.expense_id and e.trip_id = new.trip_id) then
    raise exception 'The expense must be on this trip';
  end if;
  if new.deleted_at is null and (
    select count(*) from public.receipts r
    where r.expense_id = new.expense_id and r.deleted_at is null and r.id <> new.id
  ) >= 3 then
    raise exception 'An expense can have at most 3 receipt photos';
  end if;
  return new;
end;
$$;

create trigger receipts_check before insert or update on public.receipts
  for each row execute function private.guard_receipt();
create trigger receipts_guard before insert or update on public.receipts
  for each row execute function private.guard_trip_child();
create trigger receipts_created_by before insert or update on public.receipts
  for each row execute function private.keep_created_by();
create trigger receipts_touch before insert or update on public.receipts
  for each row execute function private.touch_row();

revoke execute on function private.guard_receipt() from public, anon, authenticated;

alter table public.receipts enable row level security;

create policy "Members can read receipts" on public.receipts
  for select to authenticated using ((select private.is_trip_member(trip_id)));
create policy "Members can add receipts" on public.receipts
  for insert to authenticated with check ((select private.is_trip_member(trip_id)));
create policy "Members can update receipts" on public.receipts
  for update to authenticated
  using ((select private.is_trip_member(trip_id)))
  with check ((select private.is_trip_member(trip_id)));

revoke all on public.receipts from anon, public;
grant select, insert, update on public.receipts to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.receipts;
  end if;
end;
$$;

-- The trip a Storage path belongs to ("<trip id>/<file>"), or null for anything else.
create function private.receipt_path_trip(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}$'
    then split_part(p_name, '/', 1)::uuid
  end
$$;
grant execute on function private.receipt_path_trip(text) to authenticated;

-- Private bucket: JPEG/PNG/WebP up to 2 MB each. Only members of the trip can touch its folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create policy "Members can read receipt files" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and (select private.is_trip_member(private.receipt_path_trip(name))));
create policy "Members can upload receipt files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and (select private.is_trip_member(private.receipt_path_trip(name))));
create policy "Members can replace receipt files" on storage.objects
  for update to authenticated
  using (bucket_id = 'receipts' and (select private.is_trip_member(private.receipt_path_trip(name))))
  with check (bucket_id = 'receipts' and (select private.is_trip_member(private.receipt_path_trip(name))));
create policy "Members can delete receipt files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and (select private.is_trip_member(private.receipt_path_trip(name))));
