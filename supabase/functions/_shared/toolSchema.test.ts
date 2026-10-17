import { describe, expect, it } from 'vitest'
import { TOOLS } from './schemas.ts'
import { normalizeParameters, toFunctionTool } from './toolSchema.ts'

describe('tool schemas for other services', () => {
  it('drops fields Gemini rejects, at every depth', () => {
    expect(normalizeParameters({
      type: 'object', additionalProperties: false, required: [],
      properties: { a: { type: 'object', additionalProperties: false, properties: { b: { type: 'string' } } }, n: { type: 'integer', minimum: 0 } },
    })).toEqual({ type: 'object', properties: { a: { type: 'object', properties: { b: { type: 'string' } } }, n: { type: 'integer', minimum: 0 } } })
  })

  it('keeps a non-empty required list', () => {
    expect(normalizeParameters({ type: 'object', required: ['q'], properties: { q: { type: 'string' } } })).toMatchObject({ required: ['q'] })
  })

  it('leaves parameters out for a tool that takes none', () => {
    expect(toFunctionTool({ name: 'list_workspaces', description: 'd', parameters: { type: 'object', properties: {}, additionalProperties: false } }))
      .toEqual({ type: 'function', function: { name: 'list_workspaces', description: 'd' } })
  })

  it('makes every real tool acceptable: no forbidden fields, no empty objects', () => {
    for (const t of TOOLS) {
      const f = (toFunctionTool({ name: t.name, description: t.description, parameters: t.input_schema }).function as { parameters?: object })
      const text = JSON.stringify(f.parameters ?? {})
      expect(text, t.name).not.toContain('additionalProperties')
      expect(text, t.name).not.toContain('"required":[]')
      if (f.parameters) expect(Object.keys((f.parameters as { properties: object }).properties).length, t.name).toBeGreaterThan(0)
    }
  })
})
