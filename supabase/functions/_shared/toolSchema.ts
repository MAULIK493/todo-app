// Tool definitions are written once, in Claude's format. Other services (Gemini especially) reject some things that
// are fine for Claude, so every request to a chat-completions style service goes through this first.

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

const strip = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(strip)
  if (!isObj(node)) return node
  const out: Obj = {}
  for (const [k, v] of Object.entries(node)) {
    if (k === 'additionalProperties') continue // Gemini: "Unknown name additionalProperties"
    if (k === 'required' && Array.isArray(v) && v.length === 0) continue
    out[k] = strip(v)
  }
  return out
}

/**
 * The `parameters` to send for a tool, or undefined when it takes none. Gemini rejects an object with no properties
 * ("should be non-empty for OBJECT type"), while leaving `parameters` out is valid everywhere.
 */
export function normalizeParameters(schema: unknown): Obj | undefined {
  if (!isObj(schema)) return undefined
  const cleaned = strip(schema) as Obj
  if (cleaned.type === 'object' && (!isObj(cleaned.properties) || Object.keys(cleaned.properties).length === 0)) return undefined
  return cleaned
}

export function toFunctionTool(t: { name: string; description?: string; parameters?: unknown }): Obj {
  const parameters = normalizeParameters(t.parameters)
  return { type: 'function', function: { name: t.name, description: t.description ?? '', ...(parameters ? { parameters } : {}) } }
}
