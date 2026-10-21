import { RemoteError } from '../../sync/remote'

/** Turns a sync/server error into a message for people. */
export function describeError(error: unknown) {
  if (error instanceof RemoteError && error.kind === 'network') return 'You need to be online for this. Try again when connected.'
  if (error instanceof RemoteError && error.kind === 'auth') return 'Your sign-in has expired. Sign in again from Settings.'
  return error instanceof Error ? error.message : 'Something went wrong.'
}
