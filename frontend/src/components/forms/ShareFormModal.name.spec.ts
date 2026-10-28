import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'
import ShareFormModal from './ShareFormModal.vue'
import { formsService, type Form } from '@/services/forms'

vi.mock('@/services/forms', async () => {
  const actual = await vi.importActual<typeof import('@/services/forms')>('@/services/forms')
  return { ...actual, formsService: { update: vi.fn() } }
})

/**
 * The control over asking for a declared name (features/0054). Same two
 * behaviours as the metadata switch: it reflects the server's value, and a
 * failed write puts it back. Queried through `document.body` because the
 * Dialog teleports — see ShareFormModal.metadata.spec.ts.
 */
describe('ShareFormModal — asking for the respondent name', () => {
  const baseForm: Form = {
    id: 'form-1',
    title: 'Test Form',
    description: null,
    shareId: 'share-123',
    status: 'draft',
    pdfUrl: null,
    settings: null,
    collectsRespondentMetadata: false,
    asksRespondentName: false,
    viewCount: 0,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01'
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  async function render(form: Partial<Form> = {}) {
    mount(ShareFormModal, {
      props: { visible: true, form: { ...baseForm, ...form } },
      global: { plugins: [PrimeVue, ToastService] },
      attachTo: document.body
    })
    await nextTick()
    await nextTick()
    await flushPromises()
  }

  function toggle(): HTMLInputElement {
    const input = document.body.querySelector<HTMLInputElement>('[data-testid="asks-name-switch"] input')
    if (!input) throw new Error('The name switch is not on the dialog')
    return input
  }

  async function flip(to: boolean) {
    const input = toggle()
    input.checked = to
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await flushPromises()
  }

  it('reflects the form value rather than a default', async () => {
    await render({ asksRespondentName: true })
    expect(toggle().checked).toBe(true)

    document.body.innerHTML = ''
    await render({ asksRespondentName: false })
    expect(toggle().checked).toBe(false)
  })

  it('turns asking on through the form endpoint, and nothing else', async () => {
    vi.mocked(formsService.update).mockResolvedValue({ ...baseForm, asksRespondentName: true })

    await render()
    await flip(true)

    expect(formsService.update).toHaveBeenCalledWith('form-1', { asksRespondentName: true })
  })

  it('puts the switch back and says so when the write fails', async () => {
    vi.mocked(formsService.update).mockRejectedValue(new Error('Network is down'))

    await render()
    await flip(true)

    const message = document.body.querySelector('[data-testid="asks-name-error"]')
    expect(message?.textContent?.trim()).toBe('Network is down')
    expect(toggle().checked).toBe(false)
  })
})
