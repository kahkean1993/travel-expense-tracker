/**
 * Runs the Supabase migration in PGlite (Postgres compiled to WASM) with a
 * minimal stand-in for Supabase's auth schema and roles, then checks the
 * Row Level Security rules by acting as different users.
 *
 * This verifies the SQL and the access rules. It does not exercise
 * Supabase's hosted services (Auth emails, the Data API or Realtime).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

const migration = ['20261021000000_shared_trips.sql', '20261022000000_join_by_name.sql', '20261023000000_settlements.sql', '20261024000000_extras.sql']
  .map((file) => readFileSync(fileURLToPath(new URL(`../migrations/${file}`, import.meta.url)), 'utf8'))
  .join('\n')

const AUTH_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, is_anonymous boolean not null default false);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema auth, public to anon, authenticated;
  grant execute on all functions in schema auth to anon, authenticated;

  -- Just enough of Supabase Storage for the receipt policies.
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid default auth.uid());
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
`

const OWNER = '00000000-0000-4000-8000-000000000001'
const FRIEND = '00000000-0000-4000-8000-000000000002'
const STRANGER = '00000000-0000-4000-8000-000000000003'
// People who joined with just a name (anonymous sign-in).
const GUESTS = Array.from({ length: 5 }, (_, i) => `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`)
const isGuest = (id: string) => GUESTS.includes(id)
const TRIP = '10000000-0000-4000-8000-000000000001'
const ME_T = '20000000-0000-4000-8000-000000000001'
const FRIEND_T = '20000000-0000-4000-8000-000000000002'

let db: PGlite

/** Runs SQL as a signed-in user (or anon when userId is null). */
async function as<T = Record<string, unknown>>(userId: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`
    set role ${userId ? 'authenticated' : 'anon'};
    select set_config('request.jwt.claim.sub', '${userId ?? ''}', false);
    select set_config('request.jwt.claims', '${
      userId
        ? JSON.stringify(
            isGuest(userId)
              ? { sub: userId, is_anonymous: true }
              : { sub: userId, email: `${userId.slice(-1)}@example.test`, is_anonymous: false },
          )
        : ''
    }', false);
  `)
  try {
    return (await db.query<T>(sql, params)).rows
  } finally {
    await db.exec('reset role')
  }
}

const expenseSql = (id: string, shares: unknown, total = 1000) => `
  insert into public.expenses (id, trip_id, description, date, original_amount_minor, original_currency,
    exchange_rate, base_amount_minor, base_currency, category_id, category_name, payment_method,
    payer_traveller_id, split_mode, shares)
  values ('${id}', '${TRIP}', 'Dinner', '2026-03-02', ${total}, 'MYR', '1', ${total}, 'MYR', 'cat-food',
    'Food & Drinks', 'cash', '${ME_T}', 'equal', '${JSON.stringify(shares)}')`

beforeAll(async () => {
  db = new PGlite()
  await db.exec(AUTH_STUB)
  await db.exec(`insert into auth.users (id) values ('${OWNER}'), ('${FRIEND}'), ('${STRANGER}')`)
  await db.exec(`insert into auth.users (id, is_anonymous) values ${GUESTS.map((g) => `('${g}', true)`).join(', ')}`)
  await db.exec(migration)
})

describe('shared trips schema', () => {
  it('lets a signed-in user create a trip and makes them the owner member', async () => {
    await as(OWNER, `insert into public.trips (id, name, start_date, end_date, base_currency)
      values ('${TRIP}', 'Japan', '2026-03-01', '2026-03-07', 'MYR')`)
    const members = await as(OWNER, `select user_id, role, email from public.trip_members`)
    expect(members).toEqual([{ user_id: OWNER, role: 'owner', email: '1@example.test' }])
    await as(OWNER, `insert into public.travellers (id, trip_id, display_name) values
      ('${ME_T}', '${TRIP}', 'Me'), ('${FRIEND_T}', '${TRIP}', 'Alex')`)
  })

  it('does not let anyone create a trip owned by someone else', async () => {
    await expect(
      as(STRANGER, `insert into public.trips (id, owner_id, name, start_date, end_date, base_currency)
        values (gen_random_uuid(), '${OWNER}', 'Fake', '2026-03-01', '2026-03-02', 'MYR')`),
    ).rejects.toThrow(/row-level security/)
  })

  it('validates expense shares add up to the total', async () => {
    await expect(
      as(OWNER, expenseSql(crypto.randomUUID(), [{ travellerId: ME_T, amount: 600 }, { travellerId: FRIEND_T, amount: 399 }])),
    ).rejects.toThrow(/shares_check|check constraint/)
    await expect(as(OWNER, expenseSql(crypto.randomUUID(), [{ travellerId: ME_T, amount: -5 }], -5))).rejects.toThrow()
    await expect(as(OWNER, expenseSql(crypto.randomUUID(), [{ travellerId: ME_T, amount: 10.5 }], 10))).rejects.toThrow()
    await as(OWNER, expenseSql('30000000-0000-4000-8000-000000000001', [
      { travellerId: ME_T, amount: 500 },
      { travellerId: FRIEND_T, amount: 500 },
    ]))
  })

  it('hides trips and their data from non-members and anon', async () => {
    for (const table of ['trips', 'travellers', 'expenses', 'trip_members', 'trip_invites']) {
      expect(await as(STRANGER, `select * from public.${table}`)).toEqual([])
    }
    await expect(as(null, `select * from public.trips`)).rejects.toThrow(/permission denied/)
  })

  it('does not let a non-member write into the trip', async () => {
    await expect(
      as(STRANGER, `insert into public.travellers (id, trip_id, display_name) values (gen_random_uuid(), '${TRIP}', 'Evil')`),
    ).rejects.toThrow(/row-level security/)
    const updated = await as(STRANGER, `update public.expenses set description = 'hacked' returning id`)
    expect(updated).toEqual([])
    // Upsert onto an existing id in someone else's trip must fail, not overwrite.
    await expect(
      as(STRANGER, `insert into public.trips (id, name, start_date, end_date, base_currency)
        values ('${TRIP}', 'Mine now', '2026-03-01', '2026-03-07', 'MYR')
        on conflict (id) do update set name = excluded.name`),
    ).rejects.toThrow()
    expect((await as(OWNER, `select name from public.trips`))[0]).toEqual({ name: 'Japan' })
  })

  it('joins a member through an invite link', async () => {
    const [invite] = await as<{ token: string }>(OWNER, `insert into public.trip_invites (trip_id) values ('${TRIP}') returning token`)
    expect(invite!.token).toMatch(/^[0-9a-f]{64}$/)

    expect(await as(FRIEND, `select * from public.invite_preview($1)`, ['nope'])).toEqual([])
    const [preview] = await as(FRIEND, `select * from public.invite_preview($1)`, [invite!.token])
    expect(preview).toMatchObject({ trip_name: 'Japan', member_count: 1, already_member: false })
    await expect(as(null, `select public.accept_invite($1)`, [invite!.token])).rejects.toThrow(/permission denied/)
    // A visitor who has not signed in can still preview the invite.
    expect(await as(null, `select trip_name from public.invite_preview($1)`, [invite!.token])).toEqual([{ trip_name: 'Japan' }])
    await expect(as(FRIEND, `select public.accept_invite($1)`, ['bad-token'])).rejects.toThrow(/invalid, expired/)

    const [joined] = await as<{ accept_invite: string }>(FRIEND, `select public.accept_invite($1)`, [invite!.token])
    expect(joined!.accept_invite).toBe(TRIP)
    // Accepting twice is harmless.
    await as(FRIEND, `select public.accept_invite($1)`, [invite!.token])
    expect(await as(FRIEND, `select count(*)::int as n from public.trip_members`)).toEqual([{ n: 2 }])
  })

  it('lets members read and write shared data, stamping server time and writer', async () => {
    expect(await as(FRIEND, `select count(*)::int as n from public.expenses`)).toEqual([{ n: 1 }])
    await as(FRIEND, `update public.travellers set user_id = '${FRIEND}' where id = '${FRIEND_T}'`)
    const [row] = await as<{ updated_by: string; description: string }>(
      FRIEND,
      `update public.expenses set description = 'Ramen dinner', updated_at = '2000-01-01'
       where id = '30000000-0000-4000-8000-000000000001' returning updated_by, description, updated_at > now() - interval '1 minute' as fresh`,
    )
    expect(row).toMatchObject({ updated_by: FRIEND, description: 'Ramen dinner', fresh: true })
  })

  it('stops members moving rows between trips or taking ownership', async () => {
    await expect(
      as(FRIEND, `update public.expenses set trip_id = gen_random_uuid() where id = '30000000-0000-4000-8000-000000000001'`),
    ).rejects.toThrow()
    await as(FRIEND, `update public.trips set owner_id = '${FRIEND}', name = 'Japan 2026'`)
    expect(await as(OWNER, `select owner_id, name from public.trips`)).toEqual([{ owner_id: OWNER, name: 'Japan 2026' }])
  })

  it('only lets the owner delete the trip', async () => {
    await expect(as(FRIEND, `update public.trips set deleted_at = now()`)).rejects.toThrow(/Only the trip owner/)
    // No hard deletes for anyone.
    await expect(as(OWNER, `delete from public.expenses`)).rejects.toThrow(/permission denied/)
  })

  it('lets members leave, and owners remove members but not themselves', async () => {
    await expect(as(OWNER, `delete from public.trip_members where user_id = '${OWNER}' returning user_id`)).resolves.toEqual([])
    expect(await as(FRIEND, `delete from public.trip_members where user_id = '${FRIEND}' returning user_id`)).toEqual([
      { user_id: FRIEND },
    ])
    expect(await as(FRIEND, `select * from public.expenses`)).toEqual([])
  })

  it('rejects revoked invites and blocks writes after the trip is deleted', async () => {
    const [invite] = await as<{ token: string }>(OWNER, `insert into public.trip_invites (trip_id) values ('${TRIP}') returning token`)
    await as(OWNER, `update public.trip_invites set revoked_at = now() where token = '${invite!.token}'`)
    await expect(as(FRIEND, `select public.accept_invite($1)`, [invite!.token])).rejects.toThrow(/invalid, expired/)

    await as(OWNER, `update public.trips set deleted_at = now()`)
    await expect(
      as(OWNER, `insert into public.travellers (id, trip_id, display_name) values (gen_random_uuid(), '${TRIP}', 'Late')`),
    ).rejects.toThrow(/deleted/)
  })
})

describe('joining by name (no email)', () => {
  const TRIP2 = '10000000-0000-4000-8000-000000000002'
  const OWNER_T = '20000000-0000-4000-8000-0000000000a1'
  const ALEX_T = '20000000-0000-4000-8000-0000000000a2'
  const SAM_T = '20000000-0000-4000-8000-0000000000a3'
  let token = ''

  const accept = (user: string, traveller: string | null, newName: string | null = null) =>
    as<{ accept_invite: string }>(user, `select public.accept_invite($1, $2, $3)`, [token, traveller, newName])
  const travellerOf = async (id: string) =>
    (await as<{ user_id: string | null; display_name: string }>(OWNER, `select user_id, display_name from public.travellers where id = $1`, [id]))[0]

  it('lets a signed-out visitor preview an invite and see who can be picked', async () => {
    await as(OWNER, `insert into public.trips (id, name, start_date, end_date, base_currency)
      values ('${TRIP2}', 'Bali', '2026-04-01', '2026-04-07', 'MYR')`)
    await as(OWNER, `insert into public.travellers (id, trip_id, display_name, user_id) values
      ('${OWNER_T}', '${TRIP2}', 'Kean', '${OWNER}'), ('${ALEX_T}', '${TRIP2}', 'Alex', null), ('${SAM_T}', '${TRIP2}', 'Sam', null)`)
    const [invite] = await as<{ token: string }>(OWNER, `insert into public.trip_invites (trip_id) values ('${TRIP2}') returning token`)
    token = invite!.token

    const [preview] = await as<{ trip_name: string; member_count: number; already_member: boolean; travellers: { name: string; claimed: boolean; isOwner: boolean }[] }>(
      null,
      `select * from public.invite_preview($1)`,
      [token],
    )
    expect(preview).toMatchObject({ trip_name: 'Bali', member_count: 1, already_member: false })
    expect(preview!.travellers.map((t) => [t.name, t.claimed, t.isOwner])).toEqual([
      ['Kean', true, true],
      ['Alex', false, false],
      ['Sam', false, false],
    ])
    expect(await as(null, `select * from public.invite_preview($1)`, ['wrong'])).toEqual([])
  })

  it('does not let people without an email create trips', async () => {
    await expect(
      as(GUESTS[0]!, `insert into public.trips (id, owner_id, name, start_date, end_date, base_currency)
        values (gen_random_uuid(), '${GUESTS[0]}', 'Mine', '2026-04-01', '2026-04-02', 'MYR')`),
    ).rejects.toThrow(/row-level security/)
  })

  it('adds a friend who picks their name, linking it in one step', async () => {
    expect((await accept(GUESTS[0]!, ALEX_T))[0]!.accept_invite).toBe(TRIP2)
    expect(await travellerOf(ALEX_T)).toEqual({ user_id: GUESTS[0], display_name: 'Alex' })
    const members = await as<{ user_id: string; role: string; email: string | null }>(GUESTS[0]!, `select user_id, role, email from public.trip_members order by role desc`)
    expect(members.find((m) => m.user_id === GUESTS[0])).toEqual({ user_id: GUESTS[0], role: 'member', email: null })
    // The new member can now read and write the trip's data.
    expect((await as(GUESTS[0]!, `select id from public.travellers`)).length).toBe(3)
    await as(GUESTS[0]!, `update public.travellers set display_name = 'Alex T' where id = '${ALEX_T}'`)
  })

  it('adds a friend who is not on the list, trimming their name', async () => {
    await accept(GUESTS[1]!, null, '  Kim  ')
    const rows = await as<{ display_name: string; user_id: string }>(OWNER, `select display_name, user_id from public.travellers where user_id = '${GUESTS[1]}'`)
    expect(rows).toEqual([{ display_name: 'Kim', user_id: GUESTS[1] }])
  })

  it("does not let anyone take the owner's name or a traveller from another trip", async () => {
    await expect(accept(GUESTS[2]!, OWNER_T)).rejects.toThrow(/owns this trip/)
    await expect(accept(GUESTS[2]!, FRIEND_T)).rejects.toThrow(/no longer on this trip/)
    // Nothing was left half-done.
    expect(await as(GUESTS[2]!, `select * from public.trips`)).toEqual([])
  })

  it('keeps one traveller per person', async () => {
    await accept(GUESTS[1]!, SAM_T)
    expect(await travellerOf(SAM_T)).toMatchObject({ user_id: GUESTS[1] })
    const kim = await as(OWNER, `select user_id from public.travellers where display_name = 'Kim'`)
    expect(kim).toEqual([{ user_id: null }])
  })

  it('moves a name to a new phone and drops the old no-email membership', async () => {
    await accept(GUESTS[2]!, ALEX_T)
    expect(await travellerOf(ALEX_T)).toMatchObject({ user_id: GUESTS[2] })
    expect(await as(GUESTS[0]!, `select * from public.trips`)).toEqual([])
    expect((await as(GUESTS[2]!, `select * from public.trips`)).length).toBe(1)
  })

  it('stops a switched-off link from adding anyone, and only members can switch it off', async () => {
    expect(await as(STRANGER, `update public.trip_invites set revoked_at = now() where trip_id = '${TRIP2}' returning token`)).toEqual([])
    expect(await as(GUESTS[2]!, `update public.trip_invites set revoked_at = now() where trip_id = '${TRIP2}' returning token`)).toHaveLength(1)
    await expect(accept(GUESTS[3]!, null, 'Late')).rejects.toThrow(/invalid, expired/)
    expect(await as(null, `select * from public.invite_preview($1)`, [token])).toEqual([])
  })
})

describe('settlements, added-by and completed trips', () => {
  const TRIP4 = '10000000-0000-4000-8000-000000000004'
  const T_OWNER = '20000000-0000-4000-8000-0000000000b1'
  const T_GUEST = '20000000-0000-4000-8000-0000000000b2'
  const MEMBER = GUESTS[4]!
  const day = '2026-04-05'

  const expenseFor = (id: string, createdBy = 'null') => `
    insert into public.expenses (id, trip_id, description, date, original_amount_minor, original_currency,
      exchange_rate, base_amount_minor, base_currency, category_id, category_name, payment_method,
      payer_traveller_id, split_mode, shares, created_by)
    values ('${id}', '${TRIP4}', 'Lunch', '${day}', 1000, 'MYR', '1', 1000, 'MYR', 'cat-food', 'Food & Drinks',
      'cash', '${T_OWNER}', 'personal', '[{"travellerId":"${T_OWNER}","amount":1000}]', ${createdBy === 'null' ? 'null' : `'${createdBy}'`})
    returning created_by, updated_by`
  const settlementFor = (id: string, from: string, to: string, amount = 500, createdBy = 'null') => `
    insert into public.settlements (id, trip_id, from_traveller_id, to_traveller_id, amount_minor, paid_on, created_by)
    values ('${id}', '${TRIP4}', '${from}', '${to}', ${amount}, '${day}', ${createdBy === 'null' ? 'null' : `'${createdBy}'`})
    returning created_by, updated_by`

  it('lets members record a payment and undo it', async () => {
    await as(OWNER, `insert into public.trips (id, name, start_date, end_date, base_currency)
      values ('${TRIP4}', 'Penang', '2026-04-01', '2026-04-07', 'MYR')`)
    await as(OWNER, `insert into public.travellers (id, trip_id, display_name, user_id) values
      ('${T_OWNER}', '${TRIP4}', 'Kean', '${OWNER}'), ('${T_GUEST}', '${TRIP4}', 'Sam', null)`)
    const [invite] = await as<{ token: string }>(OWNER, `insert into public.trip_invites (trip_id) values ('${TRIP4}') returning token`)
    await as(MEMBER, `select public.accept_invite($1, $2, null)`, [invite!.token, T_GUEST])

    await as(MEMBER, settlementFor('40000000-0000-4000-8000-000000000001', T_GUEST, T_OWNER))
    expect(await as(OWNER, `select count(*)::int as n from public.settlements where deleted_at is null`)).toEqual([{ n: 1 }])
    // Anyone on the trip can undo it (soft delete), and everyone sees that.
    await as(OWNER, `update public.settlements set deleted_at = now() where id = '40000000-0000-4000-8000-000000000001'`)
    const [row] = await as<{ deleted_at: string | null }>(MEMBER, `select deleted_at from public.settlements`)
    expect(row!.deleted_at).not.toBeNull()
    await expect(as(OWNER, `delete from public.settlements`)).rejects.toThrow(/permission denied/)
  })

  it('rejects invalid payments and outsiders', async () => {
    const id = () => crypto.randomUUID()
    await expect(as(OWNER, settlementFor(id(), T_GUEST, T_OWNER, 0))).rejects.toThrow(/check constraint/)
    await expect(as(OWNER, settlementFor(id(), T_OWNER, T_OWNER))).rejects.toThrow(/cannot pay themselves/)
    await expect(as(OWNER, settlementFor(id(), T_GUEST, ME_T))).rejects.toThrow(/Both people must be on this trip/)
    await expect(as(STRANGER, settlementFor(id(), T_GUEST, T_OWNER))).rejects.toThrow(/row-level security/)
    expect(await as(STRANGER, `select * from public.settlements`)).toEqual([])
    await expect(as(null, `select * from public.settlements`)).rejects.toThrow(/permission denied/)
  })

  it('records who added a row and ignores attempts to fake it', async () => {
    // The member tries to claim the owner added the rows.
    const [e] = await as<{ created_by: string; updated_by: string }>(MEMBER, expenseFor('50000000-0000-4000-8000-000000000001', OWNER))
    expect(e).toEqual({ created_by: MEMBER, updated_by: MEMBER })
    const [s] = await as<{ created_by: string }>(MEMBER, settlementFor('40000000-0000-4000-8000-000000000002', T_GUEST, T_OWNER, 100, OWNER))
    expect(s!.created_by).toBe(MEMBER)

    // The owner edits it later: last writer changes, creator does not, even if they try.
    const [after] = await as<{ created_by: string; updated_by: string }>(
      OWNER,
      `update public.expenses set description = 'Late lunch', created_by = '${OWNER}'
       where id = '50000000-0000-4000-8000-000000000001' returning created_by, updated_by`,
    )
    expect(after).toEqual({ created_by: MEMBER, updated_by: OWNER })
  })

  it('locks expenses while the trip is completed, but not payments', async () => {
    await as(OWNER, `update public.trips set status = 'completed' where id = '${TRIP4}'`)
    await expect(as(OWNER, expenseFor(crypto.randomUUID()))).rejects.toThrow(/trip is completed/)
    await expect(
      as(MEMBER, `update public.expenses set description = 'x' where id = '50000000-0000-4000-8000-000000000001'`),
    ).rejects.toThrow(/trip is completed/)
    await expect(
      as(MEMBER, `update public.expenses set deleted_at = now() where id = '50000000-0000-4000-8000-000000000001'`),
    ).rejects.toThrow(/trip is completed/)

    // Settling up and renaming people still work.
    await as(MEMBER, settlementFor(crypto.randomUUID(), T_GUEST, T_OWNER, 200))
    await as(OWNER, `update public.travellers set display_name = 'Sam T' where id = '${T_GUEST}'`)

    // Reopening unlocks expenses again.
    await as(OWNER, `update public.trips set status = 'active' where id = '${TRIP4}'`)
    await as(MEMBER, `update public.expenses set description = 'Fine now' where id = '50000000-0000-4000-8000-000000000001'`)
  })
})

describe('category budgets', () => {
  const TRIP5 = '10000000-0000-4000-8000-000000000005'
  it('stores a budget object and rejects anything else', async () => {
    await as(OWNER, `insert into public.trips (id, name, start_date, end_date, base_currency, category_budgets)
      values ('${TRIP5}', 'Ipoh', '2026-05-01', '2026-05-03', 'MYR', '{"cat-food": 20000}')`)
    expect(await as(OWNER, `select category_budgets from public.trips where id = '${TRIP5}'`)).toEqual([{ category_budgets: { 'cat-food': 20000 } }])
    await expect(as(OWNER, `update public.trips set category_budgets = '[1]'::jsonb where id = '${TRIP5}'`)).rejects.toThrow(/category_budgets/)
  })
})

describe('receipt photos', () => {
  const TRIP6 = '10000000-0000-4000-8000-000000000006'
  const T6 = '20000000-0000-4000-8000-0000000000c1'
  const E6 = '30000000-0000-4000-8000-0000000000c1'
  const E7 = '30000000-0000-4000-8000-0000000000c2'
  const rid = (n: number) => `50000000-0000-4000-8000-00000000000${n}`
  const receipt = (n: number, expense = E6) =>
    `insert into public.receipts (id, trip_id, expense_id, mime_type, size_bytes) values ('${rid(n)}', '${TRIP6}', '${expense}', 'image/jpeg', 150000) returning created_by`

  it('lets members add receipts, limits them to 3 per expense and keeps them on the right trip', async () => {
    await as(OWNER, `insert into public.trips (id, name, start_date, end_date, base_currency) values ('${TRIP6}', 'Melaka', '2026-06-01', '2026-06-03', 'MYR')`)
    await as(OWNER, `insert into public.travellers (id, trip_id, display_name, user_id) values ('${T6}', '${TRIP6}', 'Kean', '${OWNER}')`)
    for (const id of [E6, E7]) {
      await as(OWNER, `insert into public.expenses (id, trip_id, description, date, original_amount_minor, original_currency, exchange_rate, base_amount_minor, base_currency, category_id, category_name, payment_method, payer_traveller_id, split_mode, shares)
        values ('${id}', '${TRIP6}', 'Dinner', '2026-06-01', 1000, 'MYR', '1', 1000, 'MYR', 'cat-food', 'Food', 'cash', '${T6}', 'personal', '[{"travellerId":"${T6}","amount":1000}]')`)
    }
    expect(await as(OWNER, receipt(1))).toEqual([{ created_by: OWNER }])
    await as(OWNER, receipt(2))
    await as(OWNER, receipt(3))
    await expect(as(OWNER, receipt(4))).rejects.toThrow(/at most 3/)
    // Undoing one frees a slot.
    await as(OWNER, `update public.receipts set deleted_at = now() where id = '${rid(3)}'`)
    await as(OWNER, receipt(4))
    // Wrong expense for the trip.
    await expect(as(OWNER, `insert into public.receipts (id, trip_id, expense_id, mime_type, size_bytes)
      values ('${rid(5)}', '${TRIP6}', '${TRIP}', 'image/jpeg', 100)`)).rejects.toThrow()
  })

  it('hides receipts from non-members and signed-out users', async () => {
    expect(await as(STRANGER, `select count(*)::int as n from public.receipts`)).toEqual([{ n: 0 }])
    await expect(as(null, `select * from public.receipts`)).rejects.toThrow()
    await expect(as(STRANGER, receipt(9))).rejects.toThrow()
  })

  it('rejects oversized or odd file types', async () => {
    await expect(as(OWNER, `insert into public.receipts (id, trip_id, expense_id, mime_type, size_bytes)
      values ('${rid(6)}', '${TRIP6}', '${E7}', 'image/jpeg', 5000000)`)).rejects.toThrow()
    await expect(as(OWNER, `insert into public.receipts (id, trip_id, expense_id, mime_type, size_bytes)
      values ('${rid(7)}', '${TRIP6}', '${E7}', 'application/pdf', 1000)`)).rejects.toThrow()
  })

  it('only trip members can read or write files in the trip folder', async () => {
    const path = `${TRIP6}/${rid(1)}`
    await as(OWNER, `insert into storage.objects (bucket_id, name) values ('receipts', '${path}')`)
    expect(await as(OWNER, `select count(*)::int as n from storage.objects where bucket_id = 'receipts'`)).toEqual([{ n: 1 }])
    expect(await as(STRANGER, `select count(*)::int as n from storage.objects where bucket_id = 'receipts'`)).toEqual([{ n: 0 }])
    await expect(as(STRANGER, `insert into storage.objects (bucket_id, name) values ('receipts', '${TRIP6}/${rid(8)}')`)).rejects.toThrow()
    await expect(as(OWNER, `insert into storage.objects (bucket_id, name) values ('receipts', 'not-a-trip-folder/file')`)).rejects.toThrow()
    await as(OWNER, `delete from storage.objects where name = '${path}'`)
    expect(await as(OWNER, `select count(*)::int as n from storage.objects`)).toEqual([{ n: 0 }])
  })
})
