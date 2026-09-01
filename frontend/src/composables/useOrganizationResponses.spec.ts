import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useOrganizationResponses } from './useOrganizationResponses'
import { responsesService, type OrganizationResponse } from '@/services/responses'
import { ApiError } from '@/services/api'

vi.mock('@/services/responses')

const row = (id: string, formId = 'form-1'): OrganizationResponse => ({
  id,
  formId,
  formTitle: 'A form',
  submittedAt: '2026-08-01T10:00:00.000Z',
  answerCount: 3
})

function result(responses: OrganizationResponse[], total = responses.length, offset = 0) {
  return { responses, pagination: { total, limit: 20, offset } }
}

describe('useOrganizationResponses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('asks the server for the first page, ordered by nothing of its own', async () => {
    vi.mocked(responsesService.listForOrganization).mockResolvedValue(result([row('r1')]))
    const responses = useOrganizationResponses()

    await responses.load()

    // Ordering is the server's; this never re-sorts what it was given.
    expect(responsesService.listForOrganization).toHaveBeenCalledWith({ limit: 20, offset: 0 })
    expect(responses.responses.value).toHaveLength(1)
    expect(responses.total.value).toBe(1)
  })

  it('pages forward and back, and stops at the ends', async () => {
    vi.mocked(responsesService.listForOrganization).mockResolvedValue(result([row('r1')], 45))
    const responses = useOrganizationResponses()
    await responses.load()

    expect(responses.hasPrevious.value).toBe(false)
    expect(responses.hasNext.value).toBe(true)

    await responses.next()
    expect(responsesService.listForOrganization).toHaveBeenLastCalledWith({ limit: 20, offset: 20 })
    expect(responses.page.value).toBe(2)
    expect(responses.pageCount.value).toBe(3)

    await responses.previous()
    expect(responsesService.listForOrganization).toHaveBeenLastCalledWith({ limit: 20, offset: 0 })

    // Already at the first page: nothing more is asked for.
    const callsSoFar = vi.mocked(responsesService.listForOrganization).mock.calls.length
    await responses.previous()
    expect(vi.mocked(responsesService.listForOrganization).mock.calls).toHaveLength(callsSoFar)
  })

  it('starts again at the first page when the form filter changes', async () => {
    vi.mocked(responsesService.listForOrganization).mockResolvedValue(result([row('r1')], 45))
    const responses = useOrganizationResponses()
    await responses.load()
    await responses.next()

    await responses.filterByForm('form-2')

    // Page four of a form you just chose is not where anybody wants to land.
    expect(responsesService.listForOrganization).toHaveBeenLastCalledWith({
      limit: 20,
      offset: 0,
      formId: 'form-2'
    })
    expect(responses.page.value).toBe(1)
  })

  it('drops the filter without sending an empty one', async () => {
    vi.mocked(responsesService.listForOrganization).mockResolvedValue(result([row('r1')]))
    const responses = useOrganizationResponses()
    await responses.filterByForm('form-2')

    await responses.filterByForm(null)

    expect(responsesService.listForOrganization).toHaveBeenLastCalledWith({ limit: 20, offset: 0 })
    expect(responses.formId.value).toBeNull()
  })

  it('surfaces a failure as a message rather than an empty screen', async () => {
    vi.mocked(responsesService.listForOrganization).mockRejectedValue(
      new ApiError(500, 'Request failed')
    )
    const responses = useOrganizationResponses()

    await expect(responses.load()).rejects.toBeInstanceOf(ApiError)

    expect(responses.error.value).toBe('Request failed')
    expect(responses.loading.value).toBe(false)
  })
})
