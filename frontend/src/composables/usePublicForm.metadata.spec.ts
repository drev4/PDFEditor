import { describe, it, expect, vi, beforeEach } from 'vitest'
import { usePublicForm } from './usePublicForm'
import { formsService } from '@/services/forms'

vi.mock('@/services/forms')

/**
 * What the public form is told about what is stored (features/0032).
 *
 * The two directions here are opposite on purpose and are the whole point of
 * the test: a missing `showBranding` keeps the mark, because under-claiming a
 * paid entitlement would give it away; a missing `collectsMetadata` claims
 * nothing is stored, because over-claiming in a privacy notice is the failure
 * that matters. Getting them the same way round is the mistake this catches.
 */
describe('usePublicForm — respondent metadata', () => {
  const form = {
    id: 'form-1',
    title: 'T',
    description: null,
    shareId: 'share-1',
    status: 'published' as const,
    pdfUrl: null,
    settings: null,
    collectsRespondentMetadata: false,
    viewCount: 0,
    createdAt: '',
    updatedAt: '',
    fields: []
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts false, before anything has loaded', () => {
    expect(usePublicForm().collectsMetadata.value).toBe(false)
  })

  it.each([true, false])('takes the value the server sent (%s)', async collects => {
    vi.mocked(formsService.getPublic).mockResolvedValue({
      form,
      showBranding: true,
      collectsMetadata: collects
    })

    const published = usePublicForm()
    await published.loadForm('share-1')

    expect(published.collectsMetadata.value).toBe(collects)
  })

  it('goes back to false on reset, so a second form cannot inherit the first', async () => {
    vi.mocked(formsService.getPublic).mockResolvedValue({
      form,
      showBranding: true,
      collectsMetadata: true
    })

    const published = usePublicForm()
    await published.loadForm('share-1')
    expect(published.collectsMetadata.value).toBe(true)

    published.reset()
    expect(published.collectsMetadata.value).toBe(false)
  })

  it('stays false when loading fails', async () => {
    vi.mocked(formsService.getPublic).mockRejectedValue(new Error('nope'))

    const published = usePublicForm()
    await published.loadForm('share-1')

    expect(published.collectsMetadata.value).toBe(false)
  })
})
