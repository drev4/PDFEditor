import type { Ref } from 'vue'
import { ApiError } from '@/services/api'

export interface AsyncState {
  loading: Ref<boolean>
  error: Ref<string | null>
}

export interface UseAsyncActionOptions {
  fallbackMessage?: string
  skipLoading?: boolean
}

export async function useAsyncAction<T>(
  state: AsyncState,
  action: () => Promise<T>,
  options: UseAsyncActionOptions = {}
): Promise<T> {
  const { fallbackMessage = 'Operation failed', skipLoading = false } = options

  if (!skipLoading) {
    state.loading.value = true
  }
  state.error.value = null

  try {
    return await action()
  } catch (e) {
    if (e instanceof ApiError) {
      state.error.value = e.message
    } else if (e instanceof Error) {
      state.error.value = e.message || fallbackMessage
    } else {
      state.error.value = fallbackMessage
    }
    throw e
  } finally {
    if (!skipLoading) {
      state.loading.value = false
    }
  }
}
