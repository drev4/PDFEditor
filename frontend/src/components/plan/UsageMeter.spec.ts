import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import UsageMeter from './UsageMeter.vue'

describe('UsageMeter', () => {
  function mountMeter(used: number, limit: number | null) {
    return mount(UsageMeter, { props: { label: 'Responses', used, limit } })
  }

  it('shows the numbers the way the canvas does', () => {
    const wrapper = mountMeter(412, 2000)

    // Thousands separated, and mono — the design's rule for every number.
    expect(wrapper.text()).toContain('412 / 2,000')
    expect(wrapper.find('.num').exists()).toBe(true)
  })

  it('draws the bar as the fraction used', () => {
    const wrapper = mountMeter(50, 200)

    expect(wrapper.find('.bg-accent').attributes('style')).toContain('width: 25%')
  })

  it('shows an unlimited allowance as infinity, not as a full bar', () => {
    const wrapper = mountMeter(9, null)

    expect(wrapper.text()).toContain('9 / ∞')
    // Grey, not accent: a fraction of infinity is not progress, and an accent
    // bar would invite reading it as one.
    expect(wrapper.find('.bg-field-underline').exists()).toBe(true)
    expect(wrapper.find('.bg-accent').exists()).toBe(false)
  })

  it('turns the bar to the limit colour once it is spent', () => {
    const wrapper = mountMeter(50, 50)

    expect(wrapper.find('.bg-limit').exists()).toBe(true)
  })

  it('never overflows the track when usage exceeds the limit', () => {
    // Reachable: the meter counts submissions accepted in the period, and a
    // plan can be downgraded under a month that is already spent.
    const wrapper = mountMeter(80, 50)

    expect(wrapper.find('.bg-limit').attributes('style')).toContain('width: 100%')
  })

  it('does not divide by zero on a zero limit', () => {
    const wrapper = mountMeter(0, 0)

    expect(wrapper.find('.bg-limit').attributes('style')).toContain('width: 100%')
  })
})
