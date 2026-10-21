/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL, e.g. https://abcd.supabase.co. Shared trips are off when unset. */
  readonly VITE_SUPABASE_URL?: string
  /** Supabase publishable (or legacy anon) key. Safe to expose: access is enforced by RLS. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
