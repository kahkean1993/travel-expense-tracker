-- Shared trips for Travel Expense Tracker.
--
-- Apply once to your Supabase project: paste this file into the SQL Editor
-- and run it, or use `supabase db push` if you use the Supabase CLI.
--
-- Model
-- - A trip has one owner and any number of members (trip_members).
-- - Members join through an invite link (trip_invites + accept_invite()).
-- - travellers and expenses belong to a trip; every member can read and
--   write them. Expense shares are stored inside the expense row (jsonb) so
--   an expense and its split always change together.
-- - Rows are never hard-deleted by the app: deleted_at marks a deletion so
--   other devices learn about it when they sync.
-- - updated_at is set by the database on every write and is what devices
--   use to fetch changes since their last sync.
-- - Money columns are integer minor units, matching the app's storage
--   format (see src/types/domain.ts).

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table public.trips (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  destination text not null default '' check (char_length(destination) <= 200),
  start_date date not null,
  end_date date not null,
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  budget_minor bigint not null default 0 check (budget_minor between 0 and 1000000000000000),
  status text not null default 'active' check (status in ('active', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  deleted_at timestamptz,
  check (end_date >= start_date)
);
create index trips_owner_id_idx on public.trips (owner_id);

create table public.trip_members (
  trip_id uuid not null references public.trips (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  -- Copied from the member's sign-in at join time so others can see who joined.
  email text,
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);
create index trip_members_user_id_idx on public.trip_members (user_id);

create table public.trip_invites (
  -- 64 hex characters from two random UUIDs (244 random bits).
  token text primary key default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  trip_id uuid not null references public.trips (id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  revoked_at timestamptz
);
create index trip_invites_trip_id_idx on public.trip_invites (trip_id);
create index trip_invites_created_by_idx on public.trip_invites (created_by);

create table public.travellers (
  id uuid primary key,
  trip_id uuid not null references public.trips (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 100),
  -- The signed-in person this traveller represents, if they linked themselves.
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  deleted_at timestamptz
);
create index travellers_trip_id_updated_at_idx on public.travellers (trip_id, updated_at);
create index travellers_user_id_idx on public.travellers (user_id);

-- Validates the shares array: [{ "travellerId", "name", "amount", "weight"? }]
-- with non-negative integer amounts that add up exactly to the expense total.
create function private.shares_are_valid(shares jsonb, total bigint)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(shares) = 'array'
    and jsonb_array_length(shares) > 0
    and not exists (
      select 1 from jsonb_array_elements(shares) s
      where jsonb_typeof(s -> 'amount') <> 'number'
        or (s ->> 'amount') !~ '^[0-9]+$'
        or (s ->> 'travellerId') is null
    )
    and (select sum((s ->> 'amount')::bigint) from jsonb_array_elements(shares) s) = total
$$;

create table public.expenses (
  id uuid primary key,
  trip_id uuid not null references public.trips (id) on delete cascade,
  description text not null check (char_length(description) between 1 and 200),
  date date not null,
  original_amount_minor bigint not null check (original_amount_minor between 1 and 1000000000000000),
  original_currency text not null check (original_currency ~ '^[A-Z]{3}$'),
  exchange_rate text not null check (exchange_rate ~ '^[0-9]+(\.[0-9]+)?$'),
  base_amount_minor bigint not null check (base_amount_minor between 1 and 1000000000000000),
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  category_id text not null,
  -- Lets members who don't have a custom category yet recreate it.
  category_name text not null default '',
  payment_method text not null check (payment_method in ('cash', 'credit_card', 'debit_card', 'ewallet', 'bank_transfer', 'other')),
  payment_account_note text not null default '' check (char_length(payment_account_note) <= 60),
  payer_traveller_id uuid not null references public.travellers (id),
  payer_name_snapshot text not null default '',
  notes text not null default '' check (char_length(notes) <= 2000),
  split_mode text not null check (split_mode in ('personal', 'equal', 'custom_amount', 'custom_weight')),
  shares jsonb not null check (private.shares_are_valid(shares, base_amount_minor)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  deleted_at timestamptz
);
create index expenses_trip_id_updated_at_idx on public.expenses (trip_id, updated_at);
create index expenses_payer_traveller_id_idx on public.expenses (payer_traveller_id);

-- ---------------------------------------------------------------------
-- Helper functions (private schema: not reachable through the Data API)
-- ---------------------------------------------------------------------

-- SECURITY DEFINER so policies can read trip_members without recursing into
-- its own RLS. Always scoped to the calling user.
create function private.is_trip_member(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.trip_members m
    where m.trip_id = p_trip_id and m.user_id = (select auth.uid())
  )
$$;

create function private.is_trip_owner(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.trips t
    where t.id = p_trip_id and t.owner_id = (select auth.uid())
  )
$$;

-- Policies run as the calling role, so it needs EXECUTE on these helpers.
-- The private schema is not exposed through the API, so they can't be
-- called directly from outside the database.
grant usage on schema private to authenticated;
revoke execute on all functions in schema private from public, anon;
grant execute on function private.is_trip_member(uuid) to authenticated;
grant execute on function private.is_trip_owner(uuid) to authenticated;
grant execute on function private.shares_are_valid(jsonb, bigint) to authenticated;

-- Stamps every write with the server time and the writer.
create function private.touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id then
      raise exception 'id cannot change';
    end if;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

-- Child rows: cannot move between trips or be written into a deleted trip.
create function private.guard_trip_child()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.trip_id is distinct from old.trip_id then
    raise exception 'trip_id cannot change';
  end if;
  if exists (select 1 from public.trips t where t.id = new.trip_id and t.deleted_at is not null) then
    raise exception 'This trip has been deleted';
  end if;
  return new;
end;
$$;

-- Trips: owner cannot change, and only the owner can delete or undelete.
create function private.guard_trip()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.owner_id := old.owner_id;
    if new.deleted_at is distinct from old.deleted_at and old.owner_id <> (select auth.uid()) then
      raise exception 'Only the trip owner can delete this trip';
    end if;
  end if;
  return new;
end;
$$;

-- The creator of a trip becomes its owner member.
create function private.add_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.trip_members (trip_id, user_id, role, email)
  values (new.id, new.owner_id, 'owner', (select auth.jwt()) ->> 'email')
  on conflict do nothing;
  return new;
end;
$$;

revoke execute on function private.touch_row(), private.guard_trip_child(), private.guard_trip(),
  private.add_owner_membership() from public, anon, authenticated;

create trigger trips_guard before update on public.trips
  for each row execute function private.guard_trip();
create trigger trips_touch before insert or update on public.trips
  for each row execute function private.touch_row();
create trigger trips_add_owner after insert on public.trips
  for each row execute function private.add_owner_membership();

create trigger travellers_guard before insert or update on public.travellers
  for each row execute function private.guard_trip_child();
create trigger travellers_touch before insert or update on public.travellers
  for each row execute function private.touch_row();

create trigger expenses_guard before insert or update on public.expenses
  for each row execute function private.guard_trip_child();
create trigger expenses_touch before insert or update on public.expenses
  for each row execute function private.touch_row();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.trip_invites enable row level security;
alter table public.travellers enable row level security;
alter table public.expenses enable row level security;

-- trips
create policy "Members can read their trips" on public.trips
  for select to authenticated
  using ((select private.is_trip_member(id)) or owner_id = (select auth.uid()));
create policy "Signed-in users can create trips they own" on public.trips
  for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "Members can update their trips" on public.trips
  for update to authenticated
  using ((select private.is_trip_member(id)))
  with check ((select private.is_trip_member(id)));

-- trip_members (rows are added by add_owner_membership() and accept_invite())
create policy "Members can see who is on their trips" on public.trip_members
  for select to authenticated
  using ((select private.is_trip_member(trip_id)));
create policy "Members can leave and owners can remove members" on public.trip_members
  for delete to authenticated
  using (
    (user_id = (select auth.uid()) and role <> 'owner')
    or ((select private.is_trip_owner(trip_id)) and user_id <> (select auth.uid()))
  );

-- trip_invites
create policy "Members can see their trips' invites" on public.trip_invites
  for select to authenticated
  using ((select private.is_trip_member(trip_id)));
create policy "Members can create invites" on public.trip_invites
  for insert to authenticated
  with check ((select private.is_trip_member(trip_id)) and created_by = (select auth.uid()));
create policy "Members can revoke invites" on public.trip_invites
  for update to authenticated
  using ((select private.is_trip_member(trip_id)))
  with check ((select private.is_trip_member(trip_id)));

-- travellers
create policy "Members can read travellers" on public.travellers
  for select to authenticated using ((select private.is_trip_member(trip_id)));
create policy "Members can add travellers" on public.travellers
  for insert to authenticated with check ((select private.is_trip_member(trip_id)));
create policy "Members can update travellers" on public.travellers
  for update to authenticated
  using ((select private.is_trip_member(trip_id)))
  with check ((select private.is_trip_member(trip_id)));

-- expenses
create policy "Members can read expenses" on public.expenses
  for select to authenticated using ((select private.is_trip_member(trip_id)));
create policy "Members can add expenses" on public.expenses
  for insert to authenticated with check ((select private.is_trip_member(trip_id)));
create policy "Members can update expenses" on public.expenses
  for update to authenticated
  using ((select private.is_trip_member(trip_id)))
  with check ((select private.is_trip_member(trip_id)));

-- Table privileges: signed-in users only, never anon. No DELETE: the app
-- soft-deletes with deleted_at so other devices see the deletion.
revoke all on public.trips, public.trip_members, public.trip_invites, public.travellers, public.expenses from anon, public;
grant select, insert, update on public.trips, public.trip_invites, public.travellers, public.expenses to authenticated;
grant select, delete on public.trip_members to authenticated;

-- ---------------------------------------------------------------------
-- Invite functions (exposed as RPC; SECURITY DEFINER to add a membership)
-- ---------------------------------------------------------------------

create function public.invite_preview(p_token text)
returns table (trip_id uuid, trip_name text, member_count bigint, already_member boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.name,
    (select count(*) from public.trip_members m where m.trip_id = t.id),
    exists (select 1 from public.trip_members m where m.trip_id = t.id and m.user_id = (select auth.uid()))
  from public.trip_invites i
  join public.trips t on t.id = i.trip_id
  where (select auth.uid()) is not null
    and i.token = p_token
    and i.revoked_at is null
    and i.expires_at > now()
    and t.deleted_at is null
$$;

create function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_trip uuid;
begin
  if v_user is null then
    raise exception 'Sign in to join this trip';
  end if;
  select i.trip_id into v_trip
  from public.trip_invites i
  join public.trips t on t.id = i.trip_id
  where i.token = p_token and i.revoked_at is null and i.expires_at > now() and t.deleted_at is null;
  if v_trip is null then
    raise exception 'This invite link is invalid, expired or was revoked';
  end if;
  if (select count(*) from public.trip_members m where m.trip_id = v_trip) >= 20 then
    raise exception 'This trip already has the maximum number of members';
  end if;
  insert into public.trip_members (trip_id, user_id, role, email)
  values (v_trip, v_user, 'member', (select auth.jwt()) ->> 'email')
  on conflict do nothing;
  return v_trip;
end;
$$;

revoke execute on function public.invite_preview(text), public.accept_invite(text) from public, anon;
grant execute on function public.invite_preview(text), public.accept_invite(text) to authenticated;

-- ---------------------------------------------------------------------
-- Realtime: notify devices when shared data changes (RLS still applies).
-- ---------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.trips, public.trip_members, public.travellers, public.expenses;
  end if;
end;
$$;
