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

export const responsesService = {
  async submit(data: SubmitResponseData): Promise<SubmitResponseResult> {
    const response = await api.post<SubmitResponseResult>('/responses', data)
    return response
  },

  async listByForm(formId: string, limit = 20, offset = 0): Promise<ListResponsesResult> {
    const response = await api.get<ListResponsesResult>(`/forms/${formId}/responses?limit=${limit}&offset=${offset}`)
    return response
  },

  async export(formId: string): Promise<Blob> {
    return await api.download(`/forms/${formId}/responses/export`)
  }
}
