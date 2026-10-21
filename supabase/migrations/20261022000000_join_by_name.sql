-- Friends join a shared trip with just a name (no email).
--
-- Run this once in the Supabase SQL Editor, AFTER 20261021000000_shared_trips.sql.
-- You also need to switch on Authentication → Sign In / Providers →
-- "Allow anonymous sign-ins" (see README).
--
-- What changes
-- - invite_preview() works for people who have not signed in yet and also
--   lists the trip's travellers, so the join screen can ask "who are you?".
-- - accept_invite() takes the traveller the person picked (or a new name),
--   adds the membership and links the traveller in one step.
-- - People who joined without an email (anonymous users) cannot create
--   trips of their own; they can only join trips through an invite.

-- ---------------------------------------------------------------------
-- Only people with an email can create trips
-- ---------------------------------------------------------------------

drop policy "Signed-in users can create trips they own" on public.trips;
create policy "Signed-in users with an email can create trips they own" on public.trips
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  );

-- ---------------------------------------------------------------------
-- Invite preview: no sign-in needed, includes who can be picked
-- ---------------------------------------------------------------------

drop function public.invite_preview(text);
create function public.invite_preview(p_token text)
returns table (trip_id uuid, trip_name text, member_count bigint, already_member boolean, travellers jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.name,
    (select count(*) from public.trip_members m where m.trip_id = t.id),
    exists (select 1 from public.trip_members m where m.trip_id = t.id and m.user_id = (select auth.uid())),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tr.id,
        'name', tr.display_name,
        'claimed', tr.user_id is not null,
        'isOwner', tr.user_id is not null and tr.user_id = t.owner_id
      ) order by tr.created_at, tr.id)
      from public.travellers tr
      where tr.trip_id = t.id and tr.deleted_at is null
    ), '[]'::jsonb)
  from public.trip_invites i
  join public.trips t on t.id = i.trip_id
  where i.token = p_token
    and i.revoked_at is null
    and i.expires_at > now()
    and t.deleted_at is null
$$;

revoke execute on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Accept an invite, optionally claiming a traveller or adding a new one
-- ---------------------------------------------------------------------

drop function public.accept_invite(text);
create function public.accept_invite(
  p_token text,
  p_traveller_id uuid default null,
  p_new_traveller_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_trip uuid;
  v_owner uuid;
  v_old uuid;
  v_name text := nullif(btrim(p_new_traveller_name), '');
begin
  if v_user is null then
    raise exception 'Sign in to join this trip';
  end if;

  select i.trip_id, t.owner_id into v_trip, v_owner
  from public.trip_invites i
  join public.trips t on t.id = i.trip_id
  where i.token = p_token and i.revoked_at is null and i.expires_at > now() and t.deleted_at is null;
  if v_trip is null then
    raise exception 'This invite link is invalid, expired or was revoked';
  end if;

  if not exists (select 1 from public.trip_members m where m.trip_id = v_trip and m.user_id = v_user)
     and (select count(*) from public.trip_members m where m.trip_id = v_trip) >= 20 then
    raise exception 'This trip already has the maximum number of members';
  end if;

  if p_traveller_id is not null then
    select tr.user_id into v_old
    from public.travellers tr
    where tr.id = p_traveller_id and tr.trip_id = v_trip and tr.deleted_at is null
    for update;
    if not found then
      raise exception 'That name is no longer on this trip. Go back and pick again';
    end if;
    if v_old is not null and v_old = v_owner and v_old <> v_user then
      raise exception 'That name belongs to the person who owns this trip';
    end if;
  elsif v_name is not null and char_length(v_name) > 100 then
    raise exception 'Keep the name under 100 characters';
  end if;

  insert into public.trip_members (trip_id, user_id, role, email)
  values (v_trip, v_user, 'member', nullif((select auth.jwt()) ->> 'email', ''))
  on conflict do nothing;

  if p_traveller_id is not null then
    -- One traveller per person.
    update public.travellers set user_id = null
    where trip_id = v_trip and user_id = v_user and id <> p_traveller_id;
    update public.travellers set user_id = v_user where id = p_traveller_id;
    -- Rejoining on a new phone: drop the old no-email membership of that name.
    if v_old is not null and v_old <> v_user then
      delete from public.trip_members m
      using auth.users u
      where m.trip_id = v_trip and m.user_id = v_old and m.role <> 'owner'
        and u.id = v_old and coalesce(u.is_anonymous, false);
    end if;
  elsif v_name is not null then
    update public.travellers set user_id = null where trip_id = v_trip and user_id = v_user;
    insert into public.travellers (id, trip_id, display_name, user_id)
    values (gen_random_uuid(), v_trip, v_name, v_user);
  end if;

  return v_trip;
end;
$$;

revoke execute on function public.accept_invite(text, uuid, text) from public, anon;
grant execute on function public.accept_invite(text, uuid, text) to authenticated;
