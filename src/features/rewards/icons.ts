import {
  Award, CalendarCheck, Clock, Crown, Flame, Footprints, Gem, Gift, Medal, Mountain, Rocket, Shield, Sparkles, Star, Target,
  Trophy, Zap, type LucideIcon,
} from 'lucide-react'

const ICONS: Record<string, LucideIcon> = {
  'calendar-check': CalendarCheck, clock: Clock, crown: Crown, flame: Flame, footprints: Footprints, gem: Gem, gift: Gift,
  medal: Medal, mountain: Mountain, rocket: Rocket, shield: Shield, sparkles: Sparkles, star: Star, target: Target,
  trophy: Trophy, zap: Zap,
}

export const iconFor = (name: string): LucideIcon => ICONS[name] ?? Award

/** Icons a user can pick for their own shop rewards. */
export const SHOP_ICONS = ['gift', 'star', 'trophy', 'sparkles', 'gem', 'rocket'] as const
