import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'

export function SelectBox({ checked, label, onClick }: { checked: boolean; label: string; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button" role="checkbox" aria-checked={checked} aria-label={label}
      onClick={(e) => { e.stopPropagation(); onClick(e) }}
      className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded border-2', checked ? 'border-accent bg-accent text-white' : 'border-muted')}
    >
      {checked && <Check size={12} strokeWidth={3} />}
    </button>
  )
}
