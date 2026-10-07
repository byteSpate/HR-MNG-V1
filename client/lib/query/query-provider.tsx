"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"

import { defaultQueryOptions } from "./default-options"

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: defaultQueryOptions }))
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
