import { QueryClient } from '@tanstack/react-query'

// A singleton so non-React code (locking a private workspace) can also drop cached, decrypted data.
export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })
