/** Reads a server-sent-events response and yields each event's `event:` name and joined `data:` text. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const frames = function* (flush: boolean) {
    // Frames end with a blank line (either line ending); a network chunk may hold several, or half of one.
    for (;;) {
      const m = /\r?\n\r?\n/.exec(buffer)
      if (!m) break
      const frame = buffer.slice(0, m.index)
      buffer = buffer.slice(m.index + m[0].length)
      yield frame
    }
    if (flush && buffer.trim()) { yield buffer; buffer = '' }
  }
  const parse = (frame: string) => {
    let event = 'message'
    const data: string[] = []
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    return data.length ? { event, data: data.join('\n') } : null
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (const f of frames(false)) { const p = parse(f); if (p) yield p }
    }
    buffer += decoder.decode()
    for (const f of frames(true)) { const p = parse(f); if (p) yield p }
  } finally {
    reader.releaseLock?.()
  }
}
