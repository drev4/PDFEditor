import { api } from './api'

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

export const responsesService = {
  async submit(data: SubmitResponseData): Promise<SubmitResponseResult> {
    const response = await api.post<SubmitResponseResult>('/responses', data)
    return response
  }
}
