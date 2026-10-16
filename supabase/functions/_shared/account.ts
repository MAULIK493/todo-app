// Checks for the "delete my account" request. Kept separate from the function so the rules can be tested.

export const CONFIRM_WORD = 'DELETE'

export function parseDeleteRequest(body: unknown): { ok: true } | { ok: false; error: string } {
  const confirm = typeof body === 'object' && body !== null ? (body as { confirm?: unknown }).confirm : undefined
  // Exact match on purpose: a stray click or a script cannot delete an account by accident.
  return confirm === CONFIRM_WORD ? { ok: true } : { ok: false, error: `Type ${CONFIRM_WORD} to confirm.` }
}

/** Storage files to delete, from a folder listing: only plain files directly inside the user's own folder. */
export function ownFilePaths(userId: string, listing: { name: string }[]): string[] {
  return listing.map((f) => f.name).filter((n) => n && !n.includes('/') && n !== '.emptyFolderPlaceholder').map((n) => `${userId}/${n}`)
}
