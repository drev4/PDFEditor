import { describe, it, expect, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import PrimeVue from 'primevue/config'
import SubmitPreviewModal from './SubmitPreviewModal.vue'

/**
 * The declared name in the review dialog (features/0054). The input exists only
 * when the form asks, and confirming is impossible until the name would be
 * accepted. Queried through `document.body` because the Dialog teleports.
 */
describe('SubmitPreviewModal — declared name', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  async function render(props: Record<string, unknown>) {
    const wrapper = mount(SubmitPreviewModal, {
      props: { visible: true, fields: [], answers: {}, ...props },
      global: { plugins: [PrimeVue] },
      attachTo: document.body
    })
    await nextTick()
    await nextTick()
    await flushPromises()
    return wrapper
  }

  const nameInput = () => document.body.querySelector<HTMLInputElement>('[data-testid="respondent-name-input"]')
  const confirm = () => document.body.querySelector<HTMLButtonElement>('[data-testid="confirm-submit-button"]')

  it('does not ask, and does not block, when the form does not ask', async () => {
    await render({ asksName: false })

    expect(nameInput()).toBeNull()
    expect(confirm()?.disabled).toBe(false)
  })

  it('blocks confirming until a name is given', async () => {
    const wrapper = await render({ asksName: true, respondentName: '' })

    expect(nameInput()).not.toBeNull()
    expect(confirm()?.disabled).toBe(true)

    await wrapper.setProps({ respondentName: 'Ada Lovelace' })
    await flushPromises()
    expect(confirm()?.disabled).toBe(false)
  })

  it('reports what is typed, for the parent to hold', async () => {
    const wrapper = await render({ asksName: true, respondentName: '' })

    const input = nameInput()!
    input.value = 'Ada'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    expect(wrapper.emitted('update:respondentName')?.at(-1)).toEqual(['Ada'])
  })

  it('shows the server refusal under the input', async () => {
    await render({ asksName: true, respondentName: 'Ada', nameError: 'Maximum length is 120' })

    const error = document.body.querySelector('[data-testid="respondent-name-error"]')
    expect(error?.textContent?.trim()).toBe('Maximum length is 120')
  })
})
