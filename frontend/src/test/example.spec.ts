import { describe, it, expect } from 'vitest'

/**
 * Example test to verify Vitest configuration
 * This test should pass to confirm everything is set up correctly
 */
describe('Vitest Configuration', () => {
  it('should run basic assertions', () => {
    expect(1 + 1).toBe(2)
  })

  it('should support async tests', async () => {
    const result = await Promise.resolve('success')
    expect(result).toBe('success')
  })

  it('should have access to DOM', () => {
    const div = document.createElement('div')
    div.textContent = 'test'
    expect(div.textContent).toBe('test')
  })

  it('should support array matchers', () => {
    const arr = [1, 2, 3]
    expect(arr).toHaveLength(3)
    expect(arr).toContain(2)
  })
})
