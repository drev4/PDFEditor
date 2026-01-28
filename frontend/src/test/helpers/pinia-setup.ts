import { createPinia, setActivePinia } from 'pinia'

/**
 * Setup Pinia for testing
 * Call this in beforeEach for each test suite that uses Pinia stores
 */
export const setupPinia = () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  return pinia
}

/**
 * Reset all stores to initial state
 * Useful for cleanup between tests
 */
export const resetStores = (pinia: ReturnType<typeof createPinia>) => {
  // Pinia automatically handles resetting when you create a new instance
  // This is just for explicit cleanup if needed
  setActivePinia(createPinia())
}
