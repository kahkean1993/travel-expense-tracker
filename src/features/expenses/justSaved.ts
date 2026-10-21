/** Remembers the expense that was just saved, so the list can highlight it briefly. */
const KEY = 'tet:justSaved'

export function markJustSaved(id: string) {
  try {
    sessionStorage.setItem(KEY, id)
  } catch {
    // Highlighting is a nicety; ignore storage problems.
  }
}

export function peekJustSaved(): string | null {
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function clearJustSaved() {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
