import { api } from './api'
import type { Field } from './forms'

export interface SubmitResponseData {
  formId: string
  shareId: string
  answers: Record<string, any> // { fieldId: value }
}

export interface SubmitResponseResult {
  success: boolean
  responseId: string
  message: string
}

export interface ValidationError {
  error: string
  details: Record<string, string> | { message: string; fields: string[] }
}

export interface Answer {
  id: string
  responseId: string
  fieldId: string
  value: string
}

export interface FormResponse {
  id: string
  formId: string
  submittedAt: string
  ipAddress: string | null
  userAgent: string | null
  answers: Answer[]
}

export interface ListResponsesResult {
  responses: FormResponse[]
  /**
   * Every field of the form, including ones archived by a later edit. An
   * archived field still owns answers in these responses, so it must keep its
   * column and its original label.
   */
  fields: Field[]
  pagination: {
    total: number
    limit: number
    offset: number
  }
}

/**
 * One response in the **organization-wide** listing
 * ([`features/0024`](../../../features/0024-organization-responses.md)).
 *
 * Deliberately not `FormResponse`. That one is the per-form shape and carries
 * `ipAddress`, `userAgent` and every answer, because the per-form screen renders
 * them; this is a browsing surface over everything the organization has ever
 * collected, and widening it to all of that would enlarge a privacy problem
 * (**S7** in [07-security-and-privacy](../../../docs/sot/07-security-and-privacy.md))
 * without adding anything the screen needs.
 *
 * A row says which form, when, and how many answers it holds. The detail is one
 * click away, in the per-form screen.
 */
export interface OrganizationResponse {
  id: string
  formId: string
  formTitle: string
  submittedAt: string
  answerCount: number
}

export interface OrganizationResponsesResult {
  responses: OrganizationResponse[]
  pagination: {
    /**
     * Everything matched, not the page — and **not the plan meter**. The meter
     * counts submissions accepted in a period and does not refund a deleted
     * form, so the two legitimately disagree and this number must never be
     * rendered as usage.
     */
    total: number
    limit: number
    offset: number
  }
}

export const responsesService = {
  async submit(data: SubmitResponseData): Promise<SubmitResponseResult> {
    const response = await api.post<SubmitResponseResult>('/responses', data)
    return response
  },

  /**
   * Everything the organization has collected, newest first.
   *
   * `formId` narrows to one form; a form belonging to somebody else simply
   * matches nothing, which is the server's answer and not something to check
   * here.
   */
  async listForOrganization(
    options: { limit?: number; offset?: number; formId?: string } = {}
  ): Promise<OrganizationResponsesResult> {
    const query = new URLSearchParams()
    query.set('limit', String(options.limit ?? 20))
    query.set('offset', String(options.offset ?? 0))
    if (options.formId) query.set('formId', options.formId)

    return api.get<OrganizationResponsesResult>(`/organizations/responses?${query.toString()}`)
  },

  async listByForm(formId: string, limit = 20, offset = 0): Promise<ListResponsesResult> {
    const response = await api.get<ListResponsesResult>(`/forms/${formId}/responses?limit=${limit}&offset=${offset}`)
    return response
  },

  async export(formId: string): Promise<Blob> {
    return await api.download(`/forms/${formId}/responses/export`)
  }
}
