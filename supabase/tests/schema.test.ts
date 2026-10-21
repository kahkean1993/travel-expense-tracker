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

const migration = readFileSync(
  fileURLToPath(new URL('../migrations/20261021000000_shared_trips.sql', import.meta.url)),
  'utf8',
)

const AUTH_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema auth, public to anon, authenticated;
  grant execute on all functions in schema auth to anon, authenticated;
`

const OWNER = '00000000-0000-4000-8000-000000000001'
const FRIEND = '00000000-0000-4000-8000-000000000002'
const STRANGER = '00000000-0000-4000-8000-000000000003'
const TRIP = '10000000-0000-4000-8000-000000000001'
const ME_T = '20000000-0000-4000-8000-000000000001'
const FRIEND_T = '20000000-0000-4000-8000-000000000002'

let db: PGlite

/** Runs SQL as a signed-in user (or anon when userId is null). */
async function as<T = Record<string, unknown>>(userId: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`
    set role ${userId ? 'authenticated' : 'anon'};
    select set_config('request.jwt.claim.sub', '${userId ?? ''}', false);
    select set_config('request.jwt.claims', '${userId ? JSON.stringify({ sub: userId, email: `${userId.slice(-1)}@example.test` }) : ''}', false);
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
