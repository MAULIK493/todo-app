/** Every word of `search` appears somewhere in the given text. Used where the server can't search (encrypted data). */
export function matchesSearch(search: string, ...fields: string[]): boolean {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const text = fields.join(' ').toLowerCase()
  return words.every((w) => text.includes(w))
}
