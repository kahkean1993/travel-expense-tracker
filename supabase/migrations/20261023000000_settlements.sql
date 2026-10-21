-- Settlement payments, "added by" tracking and locking of completed trips.
--
-- Run this once in the Supabase SQL Editor, AFTER the two earlier files
-- (20261021000000_shared_trips.sql and 20261022000000_join_by_name.sql).
--
-- What changes
-- - settlements: a record of "X paid Y <amount>" towards settling up a trip.
--   Balances and the "who pays whom" suggestions take recorded payments into
--   account. Rows are never hard-deleted (deleted_at marks an undone payment).
-- - created_by on expenses and settlements: who first added the row. The
--   database sets it, so it can't be faked by the app.
-- - While a trip is marked completed, its expenses can't be added, changed
--   or deleted. Recording settlement payments stays possible.

-- ---------------------------------------------------------------------
-- Who added an expense
-- ---------------------------------------------------------------------

alter table public.expenses add column created_by uuid default auth.uid();

-- Always the caller on insert, and never changeable afterwards.
create function private.keep_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

create trigger expenses_created_by before insert or update on public.expenses
  for each row execute function private.keep_created_by();

-- ---------------------------------------------------------------------
-- Completed trips: expenses are locked
-- ---------------------------------------------------------------------

create function private.guard_expense_trip_open()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.trips t
    where t.id = new.trip_id and t.status = 'completed' and t.deleted_at is null
  ) then
    raise exception 'This trip is completed. Reopen it to change expenses';
  end if;
  return new;
end;
$$;

create trigger expenses_lock before insert or update on public.expenses
  for each row execute function private.guard_expense_trip_open();

-- ---------------------------------------------------------------------
-- Settlement payments
-- ---------------------------------------------------------------------

create table public.settlements (
  id uuid primary key,
  trip_id uuid not null references public.trips (id) on delete cascade,
  from_traveller_id uuid not null references public.travellers (id),
  to_traveller_id uuid not null references public.travellers (id),
  -- Integer minor units of the trip's base currency.
  amount_minor bigint not null check (amount_minor between 1 and 1000000000000000),
  paid_on date not null,
  note text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  created_by uuid default auth.uid(),
  deleted_at timestamptz,
  check (from_traveller_id <> to_traveller_id)
);
create index settlements_trip_id_updated_at_idx on public.settlements (trip_id, updated_at);
create index settlements_from_traveller_id_idx on public.settlements (from_traveller_id);
create index settlements_to_traveller_id_idx on public.settlements (to_traveller_id);

-- Both people must be travellers of the same trip as the payment.
create function private.guard_settlement_people()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.from_traveller_id = new.to_traveller_id then
    raise exception 'Someone cannot pay themselves';
  end if;
  if (select count(*) from public.travellers t
      where t.id in (new.from_traveller_id, new.to_traveller_id) and t.trip_id = new.trip_id) <> 2 then
    raise exception 'Both people must be on this trip';
  end if;
  return new;
end;
$$;

create trigger settlements_people before insert or update on public.settlements
  for each row execute function private.guard_settlement_people();
create trigger settlements_guard before insert or update on public.settlements
  for each row execute function private.guard_trip_child();
create trigger settlements_created_by before insert or update on public.settlements
  for each row execute function private.keep_created_by();
create trigger settlements_touch before insert or update on public.settlements
  for each row execute function private.touch_row();

revoke execute on function private.keep_created_by(), private.guard_expense_trip_open(),
  private.guard_settlement_people() from public, anon, authenticated;

alter table public.settlements enable row level security;

create policy "Members can read settlements" on public.settlements
  for select to authenticated using ((select private.is_trip_member(trip_id)));
create policy "Members can record settlements" on public.settlements
  for insert to authenticated with check ((select private.is_trip_member(trip_id)));
create policy "Members can update settlements" on public.settlements
  for update to authenticated
  using ((select private.is_trip_member(trip_id)))
  with check ((select private.is_trip_member(trip_id)));

-- No DELETE: an undone payment is marked with deleted_at so other phones see it.
revoke all on public.settlements from anon, public;
grant select, insert, update on public.settlements to authenticated;

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.settlements;
  end if;
end;
$$;
