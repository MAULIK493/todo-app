import { Coins, Gift, Trash2 } from 'lucide-react'
import { EmptyState } from '@/components/fx/EmptyState'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { spring } from '@/lib/motion'
import { timeAgo } from '@/lib/dates'
import { useToasts } from '@/stores/toasts'
import { burst } from './celebrate'
import { useRedemptions, useRewardMutations, useShopItems } from './api'
import { iconFor, SHOP_ICONS } from './icons'
import type { RewardSummary } from './types'

const field = 'glass w-full rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-accent'

export function ShopTab({ r }: { r: RewardSummary }) {
  const { data: items = [], isLoading, error } = useShopItems()
  const { data: history = [] } = useRedemptions()
  const { addItem, removeItem, redeem } = useRewardMutations()
  const push = useToasts((s) => s.push)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [cost, setCost] = useState(50)
  const [icon, setIcon] = useState<string>('gift')
  const validCost = Number.isInteger(cost) && cost >= 1 && cost <= 100000

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">Create your own real-life rewards, like a coffee, a movie night or a day off, and earn them with coins.</p>

      {isLoading && <div className="glass h-24 shimmer rounded-2xl" aria-busy />}
      {error && <p className="text-red-400" role="alert">Could not load the shop: {error.message}</p>}
      {!isLoading && items.length === 0 && <div className="glass rounded-2xl"><EmptyState icon={Gift} title="No rewards yet. Add your first one below." /></div>}

      <ul className="grid gap-3 sm:grid-cols-2">
        <AnimatePresence>
          {items.map((it) => {
            const Icon = iconFor(it.icon)
            const canAfford = r.coins >= it.cost_coins
            return (
              <motion.li key={it.id} layout transition={spring} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="glass flex flex-col gap-2 rounded-2xl p-4">
                <div className="flex items-start gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-white"><Icon size={18} /></div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{it.name}</p>
                    {it.description && <p className="text-sm text-muted">{it.description}</p>}
                  </div>
                  <button aria-label={`Remove ${it.name}`} onClick={() => removeItem.mutate(it.id)} className="rounded p-1 text-muted hover:text-red-400"><Trash2 size={14} /></button>
                </div>
                <button
                  disabled={!canAfford || redeem.isPending}
                  onClick={() => redeem.mutate(it.id, {
                    onSuccess: () => { burst('small'); push(`Enjoy: ${it.name}!`) },
                    onError: (e) => push(`Could not redeem: ${e.message}`),
                  })}
                  className={cn('flex items-center justify-center gap-1 rounded-lg py-1.5 text-sm', canAfford ? 'bg-accent text-white' : 'glass text-muted')}
                >
                  <Coins size={14} /> {it.cost_coins.toLocaleString()} {canAfford ? '· Redeem' : `· need ${(it.cost_coins - r.coins).toLocaleString()} more`}
                </button>
              </motion.li>
            )
          })}
        </AnimatePresence>
      </ul>

      <form
        className="glass space-y-3 rounded-2xl p-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim() || !validCost) return
          addItem.mutate({ name: name.trim(), description: description.trim(), icon, cost_coins: cost }, {
            onSuccess: () => { setName(''); setDescription('') },
            onError: (err) => push(`Could not add: ${err.message}`),
          })
        }}
      >
        <h2 className="font-semibold">Add a reward</h2>
        <input className={field} placeholder="Name (e.g. Movie night)" aria-label="Reward name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        <input className={field} placeholder="Description (optional)" aria-label="Reward description" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted">Cost
            <input type="number" min={1} max={100000} className="glass w-24 rounded-lg px-2 py-1 text-center text-text outline-none focus:ring-2 focus:ring-accent" value={cost} onChange={(e) => setCost(Number(e.target.value))} />
            <Coins size={14} className="text-amber-400" />
          </label>
          <div role="radiogroup" aria-label="Icon" className="flex gap-1">
            {SHOP_ICONS.map((n) => {
              const I = iconFor(n)
              return (
                <button key={n} type="button" role="radio" aria-checked={icon === n} aria-label={n} onClick={() => setIcon(n)} className={cn('rounded-lg p-1.5', icon === n ? 'bg-accent text-white' : 'glass')}>
                  <I size={16} />
                </button>
              )
            })}
          </div>
          <button disabled={!name.trim() || !validCost || addItem.isPending} className="ml-auto rounded-lg bg-accent px-4 py-1.5 text-white disabled:opacity-50">Add</button>
        </div>
      </form>

      {history.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Redeemed</h2>
          <ul className="space-y-1 text-sm">
            {history.map((h) => (
              <li key={h.id} className="glass flex justify-between rounded-lg px-3 py-1.5">
                <span>{h.item_name}</span>
                <span className="text-muted">−{h.cost_coins} · {timeAgo(h.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
