/**
 * App-wide wiring for shared trips: the Supabase client, sign-in state and
 * when to run sync. Everything here is inactive when the Supabase settings
 * are missing, and the app then works exactly as the local-only version.
 */
import { useSyncExternalStore } from 'react'
import { createClient, type Session } from '@supabase/supabase-js'
import { db } from '../db/schema'
import { onLocalSave } from '../db/saveStatus'
import { SyncEngine, type SyncStatus } from './engine'
import { SupabaseRemote } from './supabaseRemote'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const cloudConfigured = Boolean(url && key)

const supabase = cloudConfigured
  ? createClient(url!, key!, {
      auth: {
        // PKCE puts a one-time ?code= in the link instead of tokens in the
        // URL fragment, which this app uses for its own routes.
        flowType: 'pkce',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null

const remote = supabase ? new SupabaseRemote(supabase) : null
export const syncEngine = remote ? new SyncEngine(db, remote) : null

// ---------- Sign-in state ----------

export type AuthState =
  | { status: 'disabled' }
  | { status: 'loading' }
  | { status: 'signedOut'; error?: string }
  /** `anonymous`: joined with just a name (no email); can join trips but not create them. */
  | { status: 'signedIn'; userId: string; email: string; anonymous: boolean }

let auth: AuthState = supabase ? { status: 'loading' } : { status: 'disabled' }
const authListeners = new Set<() => void>()
function setAuth(next: AuthState) {
  auth = next
  authListeners.forEach((l) => l())
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (l) => {
      authListeners.add(l)
      return () => authListeners.delete(l)
    },
    () => auth,
  )
}

const disabledStatus: SyncStatus = { phase: 'signedOut', lastSyncedAt: null, message: null }
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => syncEngine?.subscribe(l) ?? (() => {}),
    () => syncEngine?.getStatus() ?? disabledStatus,
  )
}

/** Error passed back in the URL when a sign-in link is expired or invalid. */
function takeUrlAuthError(): string | undefined {
  const params = new URLSearchParams(window.location.search)
  const message = params.get('error_description')
  if (params.has('code') || params.has('error') || message) {
    history.replaceState(null, '', window.location.pathname + window.location.hash)
  }
  return message ? message.replace(/\+/g, ' ') : undefined
}

let stopRealtime: (() => void) | null = null

function applySession(session: Session | null) {
  remote!.setUser(session?.user.id ?? null)
  if (session) {
    setAuth({
      status: 'signedIn',
      userId: session.user.id,
      email: session.user.email ?? '',
      anonymous: session.user.is_anonymous ?? false,
    })
    // Live updates only while signed in (saves connections on the free tier).
    stopRealtime ??= remote!.subscribe(() => requestSync(300))
    requestSync(0)
  } else {
    stopRealtime?.()
    stopRealtime = null
    setAuth({ status: 'signedOut' })
  }
}

// ---------- Scheduling ----------

let timer: ReturnType<typeof setTimeout> | undefined

/** Runs a sync soon. Repeated requests within the delay collapse into one. */
export function requestSync(delayMs = 800) {
  if (!syncEngine || auth.status !== 'signedIn') return
  clearTimeout(timer)
  timer = setTimeout(() => void syncEngine.sync(), delayMs)
}

export function startCloud() {
  if (!supabase || !remote) return
  const urlError = takeUrlAuthError()
  // Supabase recommends not awaiting other Supabase calls inside this
  // callback, so work is deferred with setTimeout.
  supabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => {
      applySession(session)
      if (!session && urlError) setAuth({ status: 'signedOut', error: urlError })
    }, 0)
  })
  onLocalSave(() => requestSync())
  window.addEventListener('online', () => requestSync(0))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestSync(0)
  })
  setInterval(() => {
    if (document.visibilityState === 'visible') requestSync(0)
  }, 60_000)
}

// ---------- Actions ----------

function requireClient() {
  if (!supabase) throw new Error('Shared trips are not set up for this app.')
  return supabase
}

/** Emails a sign-in link (and a 6-digit code, if the email template includes it). */
export async function sendSignInEmail(email: string) {
  const { error } = await requireClient().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
  })
  if (error) throw new Error(friendlyAuthError(error.message))
}

/**
 * Creates a no-email account on this device, so a friend can join a trip
 * with just a name. Needs "Allow anonymous sign-ins" on in Supabase.
 */
export async function signInWithoutEmail() {
  const { data, error } = await requireClient().auth.signInAnonymously()
  if (error) throw new Error(friendlyAuthError(error.message))
  applySession(data.session)
}

/** Signs in with the 6-digit code from the email. */
export async function verifySignInCode(email: string, code: string) {
  const { error } = await requireClient().auth.verifyOtp({ email, token: code, type: 'email' })
  if (error) throw new Error(friendlyAuthError(error.message))
}

/** Signs out and removes shared trips from this device (they stay online). */
export async function signOut() {
  await syncEngine?.removeAllCloudTrips()
  await requireClient().auth.signOut()
  applySession(null)
}

function friendlyAuthError(message: string) {
  if (/anonymous/i.test(message) && /disabled|not enabled|not allowed/i.test(message)) {
    return 'Joining without an email is not switched on yet. Ask the person who shared the trip to turn on "Allow anonymous sign-ins" in Supabase.'
  }
  if (/rate limit|security purposes|seconds/i.test(message)) {
    return 'Too many emails requested. Wait a minute, then try again.'
  }
  if (/expired|invalid/i.test(message)) return 'That code is invalid or has expired. Request a new email.'
  if (/fetch|network/i.test(message)) return 'Could not reach the server. Check your connection.'
  return message
}

// ---------- Remembering what to do after an email sign-in ----------
// The sign-in email opens the app's home page, so we note where the person was.

const PENDING_INVITE_KEY = 'tet:pendingInvite'
const PENDING_SHARE_KEY = 'tet:pendingShare'

function remember(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // Storage unavailable; the person just continues manually.
  }
}

function recall(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function inviteUrl(token: string) {
  return `${window.location.origin}${import.meta.env.BASE_URL}#/join/${token}`
}

/** The invite the person was opening when they chose to sign in with email. */
export const rememberPendingInvite = (token: string | null) => remember(PENDING_INVITE_KEY, token)
export const pendingInvite = () => recall(PENDING_INVITE_KEY)

/** The trip the person was about to share when they chose to sign in with email. */
export const rememberPendingShare = (tripId: string | null) => remember(PENDING_SHARE_KEY, tripId)
export const pendingShare = () => recall(PENDING_SHARE_KEY)
