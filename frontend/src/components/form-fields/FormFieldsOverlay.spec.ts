import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import FormFieldsOverlay from './FormFieldsOverlay.vue'
import { useFormFieldsStore } from '@/stores/formFields.store'

vi.mock('@/services/fields')
vi.mock('@/composables/useFormManagement', () => ({
  useFormManagement: () => ({ autoInitializeForm: vi.fn().mockResolvedValue(undefined) })
}))
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: vi.fn() }) }))

/**
 * The marquee (features/0050).
 *
 * The subject here is the one decision this feature had to make and could not
 * avoid: **the overlay covers the whole page and must not hold the pointer**,
 * because `.text-layer` underneath owns the PDF's selectable text and everything
 * the search highlights. So it takes it only while the select mode is armed, and
 * the first test is the one that matters most — it fails the day somebody
 * "simplifies" the mode away.
 */

const field = (id: string, x: number, y: number) => ({
  id,
  type: 'checkbox' as const,
  name: `check_${id}`,
  label: `Check ${id}`,
  required: false,
  position: { x, y, width: 20, height: 20, page: 1 }
})

const CANVAS = { canvasWidth: 600, canvasHeight: 800, displayScale: 1 }

describe('FormFieldsOverlay marquee', () => {
  let store: ReturnType<typeof useFormFieldsStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useFormFieldsStore()
    store.setCurrentForm('form-1')
    // A column of three checkboxes, the shape this gesture exists for.
    store.loadFieldsFromForm([field('a', 100, 100), field('b', 100, 200), field('c', 100, 300)] as any)
    vi.clearAllMocks()
  })

  /**
   * The template opens with a comment, which makes the component a fragment —
   * so `wrapper.element` is not the overlay and every class and event has to go
   * through this.
   */
  const root = (wrapper: ReturnType<typeof mount>) => wrapper.find('.form-fields-overlay')

  const stateBox = (wrapper: ReturnType<typeof mount>, width: number, height: number) => {
    // jsdom lays nothing out, so the overlay's own box has to be stated. The
    // component divides the pointer by `displayScale` against this origin.
    vi.spyOn(root(wrapper).element as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON: () => ({})
    } as DOMRect)
  }

  const mountOverlay = () => {
    const wrapper = mount(FormFieldsOverlay, { props: CANVAS })
    stateBox(wrapper, 600, 800)
    return wrapper
  }

  const drag = async (
    wrapper: ReturnType<typeof mountOverlay>,
    from: { x: number; y: number },
    to: { x: number; y: number }
  ) => {
    await root(wrapper).trigger('mousedown', { button: 0, clientX: from.x, clientY: from.y })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: to.x, clientY: to.y }))
    await wrapper.vm.$nextTick()
    window.dispatchEvent(new MouseEvent('mouseup'))
    await wrapper.vm.$nextTick()
  }

  it('does not take the pointer until the select mode is armed', () => {
    const wrapper = mountOverlay()

    expect(root(wrapper).classes()).not.toContain('select-mode')

    store.setSelectMode(true)
    return wrapper.vm.$nextTick().then(() => {
      expect(root(wrapper).classes()).toContain('select-mode')

      store.setSelectMode(false)
      return wrapper.vm.$nextTick().then(() => {
        expect(root(wrapper).classes()).not.toContain('select-mode')
      })
    })
  })

  it('ignores a drag while the mode is off, so the page keeps its own gestures', async () => {
    const wrapper = mountOverlay()

    await drag(wrapper, { x: 90, y: 90 }, { x: 320, y: 240 })

    expect(store.selectedFieldIds).toEqual([])
    expect(wrapper.find('[data-testid="marquee-band"]').exists()).toBe(false)
  })

  it('selects every field the band touches', async () => {
    const wrapper = mountOverlay()
    store.setSelectMode(true)
    await wrapper.vm.$nextTick()

    // A narrow band down the middle of the column: it touches all three and
    // contains none of them.
    await drag(wrapper, { x: 105, y: 90 }, { x: 115, y: 330 })

    expect(store.selectedFieldIds).toEqual(['a', 'b', 'c'])
  })

  it('paints the band while dragging and takes it away on release', async () => {
    const wrapper = mountOverlay()
    store.setSelectMode(true)
    await wrapper.vm.$nextTick()

    await root(wrapper).trigger('mousedown', { button: 0, clientX: 100, clientY: 100 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 260 }))
    await wrapper.vm.$nextTick()

    const band = wrapper.find('[data-testid="marquee-band"]')
    expect(band.exists()).toBe(true)
    expect(band.attributes('style')).toContain('width: 100px')
    expect(band.attributes('style')).toContain('height: 160px')

    window.dispatchEvent(new MouseEvent('mouseup'))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="marquee-band"]').exists()).toBe(false)
  })

  /**
   * A band that caught nothing is the same gesture as clicking empty page. If it
   * left the previous selection standing, the next align — or the next delete —
   * would act on fields the author had just tried to let go of.
   */
  it('clears the selection when the band catches nothing', async () => {
    const wrapper = mountOverlay()
    store.selectFields(['a', 'b'])
    store.setSelectMode(true)
    await wrapper.vm.$nextTick()

    await drag(wrapper, { x: 400, y: 500 }, { x: 500, y: 600 })

    expect(store.selectedFieldIds).toEqual([])
  })

  /**
   * The overlay is drawn with one `scale(displayScale)` transform, so the
   * pointer has to be divided back out. Without it the band drifts further from
   * the cursor the narrower the window is — 0048 hit the same arithmetic from
   * the other side, where 110 px of mouse was 46 px on screen.
   */
  it('maps the pointer through the display scale', async () => {
    const wrapper = mount(FormFieldsOverlay, { props: { ...CANVAS, displayScale: 0.5 } })
    stateBox(wrapper, 300, 400)

    store.setSelectMode(true)
    await wrapper.vm.$nextTick()

    // Half-size on screen, so this drag is 90..130 by 90..150 in the overlay's
    // own pixels — over the first checkbox and short of the second. Without the
    // division it would be 45..65 by 45..75, which is empty page and catches
    // nothing at all.
    await drag(wrapper as never, { x: 45, y: 45 }, { x: 65, y: 75 })

    expect(store.selectedFieldIds).toEqual(['a'])
  })
})
