import { vi } from 'vitest'

export const NuxtAuthHandler = (config: unknown): unknown => config
export const getToken = vi.fn()
