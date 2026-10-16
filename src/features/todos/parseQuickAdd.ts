import { addDays, startOfDay } from '@/lib/dates'
import type { Recurrence } from './types'

export type ParsedTodo = {
  title: string
  due_at: string | null
  priority: 0 | 1 | 2 | 3
  tags: string[]
  recurrence: Recurrence | null
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/**
 * Parses quick-add text such as "call mom tomorrow 6pm !high #family every week".
 * Recognised tokens are removed from the title; everything else stays as typed.
 */
export function parseQuickAdd(input: string, now = new Date(), opts: { tags?: boolean } = {}): ParsedTodo {
  let text = ` ${input} `
  const take = (re: RegExp) => {
    const m = re.exec(text)
    if (m) text = text.replace(re, ' ')
    return m
  }

  const tags: string[] = []
  // Private workspaces have no tags, so "#word" is left in the title as typed.
  if (opts.tags !== false) {
    text = text.replace(/\s#([\p{L}\p{N}_-]+)/gu, (_m, t: string) => {
      tags.push(t.toLowerCase())
      return ' '
    })
  }

  let priority: ParsedTodo['priority'] = 0
  const pm = take(/\s!(high|medium|med|low|[1-3])(?=\s)/i)
  if (pm) {
    const p = pm[1].toLowerCase()
    priority = (p === 'high' ? 3 : p === 'medium' || p === 'med' ? 2 : p === 'low' ? 1 : Number(p)) as ParsedTodo['priority']
  }

  let recurrence: Recurrence | null = null
  const rm = take(/\s(?:every\s+(day|week|month)|(daily|weekly|monthly))(?=\s)/i)
  if (rm) {
    const w = (rm[1] ?? rm[2]).toLowerCase()
    recurrence = w.startsWith('day') || w === 'daily' ? 'daily' : w.startsWith('week') ? 'weekly' : 'monthly'
  }

  // Time of day: "6pm", "at 6:30 pm" or 24h "18:00".
  let hours: number | null = null
  let minutes = 0
  const tm = take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?=\s)/i)
  if (tm) {
    hours = Number(tm[1]) % 12 + (tm[3].toLowerCase() === 'pm' ? 12 : 0)
    minutes = Number(tm[2] ?? 0)
  } else {
    const t24 = take(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/)
    if (t24) {
      hours = Number(t24[1])
      minutes = Number(t24[2])
    }
  }

  const today = startOfDay(now)
  let date: Date | null = null
  let defaultHour = 9
  let m: RegExpExecArray | null
  if ((m = take(/\s(\d{4})-(\d{2})-(\d{2})(?=\s)/))) date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  else if ((m = take(/\sin\s+(\d+)\s+(day|week)s?(?=\s)/i))) date = addDays(today, Number(m[1]) * (m[2].toLowerCase() === 'week' ? 7 : 1))
  else if (take(/\snext\s+week(?=\s)/i)) date = addDays(today, 7)
  else if (take(/\stomorrow(?=\s)/i)) date = addDays(today, 1)
  else if (take(/\stonight(?=\s)/i)) { date = today; defaultHour = 20 }
  else if (take(/\stoday(?=\s)/i)) date = today
  else if ((m = take(new RegExp(`\\s(?:on\\s+|next\\s+)?(${DAYS.join('|')})(?=\\s)`, 'i')))) {
    const ahead = (DAYS.indexOf(m[1].toLowerCase()) - today.getDay() + 7) % 7 || 7
    date = addDays(today, ahead)
  }

  let due: Date | null = null
  if (date || hours !== null) {
    due = new Date(date ?? today)
    due.setHours(hours ?? defaultHour, hours !== null ? minutes : 0, 0, 0)
    // A bare time that already passed today means tomorrow.
    if (!date && due <= now) due = addDays(due, 1)
  } else if (recurrence) {
    // Recurring todos need a due date to repeat from.
    due = new Date(today)
    due.setHours(defaultHour, 0, 0, 0)
  }

  const title = text.replace(/\s+/g, ' ').trim() || input.trim()
  return { title, due_at: due ? due.toISOString() : null, priority, tags: [...new Set(tags)], recurrence }
}
