import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Achievement, LedgerEntry, Redemption, RewardSummary, ShopItem } from './types'

const fail = (e: { message: string } | null) => {
  if (e) throw new Error(e.message)
}

export function useRewardSummary() {
  return useQuery({
    queryKey: ['rewards', 'summary'],
    queryFn: async (): Promise<RewardSummary | null> => {
      const { data, error } = await supabase.rpc('reward_summary')
      if (error) throw new Error(error.message)
      return data as RewardSummary | null
    },
  })
}

export function useAchievementCatalog() {
  return useQuery({
    queryKey: ['rewards', 'catalog'],
    staleTime: Infinity, // static data
    queryFn: async (): Promise<Achievement[]> => {
      const { data, error } = await supabase.from('achievements').select('*').order('sort')
      if (error) throw new Error(error.message)
      return data
    },
  })
}

export function useLedger() {
  return useQuery({
    queryKey: ['rewards', 'ledger'],
    queryFn: async (): Promise<LedgerEntry[]> => {
      const { data, error } = await supabase
        .from('rewards_ledger').select('id, kind, xp, coins, day, meta, created_at').order('id', { ascending: false }).limit(50)
      if (error) throw new Error(error.message)
      return data
    },
  })
}

export function useShopItems() {
  return useQuery({
    queryKey: ['rewards', 'shop'],
    queryFn: async (): Promise<ShopItem[]> => {
      const { data, error } = await supabase
        .from('reward_shop_items').select('id, name, description, icon, cost_coins').eq('active', true).order('cost_coins').order('created_at')
      if (error) throw new Error(error.message)
      return data
    },
  })
}

export function useRedemptions() {
  return useQuery({
    queryKey: ['rewards', 'redemptions'],
    queryFn: async (): Promise<Redemption[]> => {
      const { data, error } = await supabase
        .from('redemptions').select('id, item_name, cost_coins, created_at').order('created_at', { ascending: false }).limit(20)
      if (error) throw new Error(error.message)
      return data
    },
  })
}

export function useRewardMutations() {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['rewards'] })

  return {
    addItem: useMutation({
      mutationFn: async (v: { name: string; description: string; icon: string; cost_coins: number }) =>
        fail((await supabase.from('reward_shop_items').insert(v)).error),
      onSettled: refresh,
    }),
    // Soft-delete keeps old redemptions pointing at a real row; the snapshot name survives either way.
    removeItem: useMutation({
      mutationFn: async (id: string) => fail((await supabase.from('reward_shop_items').update({ active: false }).eq('id', id)).error),
      onSettled: refresh,
    }),
    redeem: useMutation({
      mutationFn: async (id: string) => fail((await supabase.rpc('redeem_reward', { p_item: id })).error),
      onSettled: refresh,
    }),
    buyFreeze: useMutation({
      mutationFn: async () => fail((await supabase.rpc('buy_streak_freeze')).error),
      onSettled: refresh,
    }),
    setGoals: useMutation({
      mutationFn: async (v: { daily_goal: number; weekly_goal: number }) => {
        const { data: u } = await supabase.auth.getUser()
        fail((await supabase.from('profiles').update(v).eq('id', u.user!.id)).error)
      },
      onSettled: refresh,
    }),
    setTimezone: useMutation({
      mutationFn: async (tz: string) => fail((await supabase.rpc('set_timezone', { p_tz: tz })).error),
      onSettled: refresh,
    }),
  }
}
