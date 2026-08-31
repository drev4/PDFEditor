import { api } from './api'

export type FormStatus = 'draft' | 'published' | 'closed'
export type FieldType = 'text' | 'textarea' | 'checkbox' | 'radio' | 'dropdown'

export interface FieldPosition {
  x: number
  y: number
  width: number
  height: number
  page: number
}

export interface Field {
  id: string
  formId: string
  type: FieldType
  name: string
  label: string
  required: boolean
  position: FieldPosition
  options?: string[]
  validation?: {
    minLength?: number
    maxLength?: number
    pattern?: string
  }
  order: number
  createdAt: string
}

export interface Form {
  id: string
  // No owner id. Forms belong to an organization and the server decides who may
  // reach one; the client is deliberately unaware that organizations exist.
  title: string
  description: string | null
  shareId: string
  status: FormStatus
  pdfUrl: string | null
  settings: Record<string, unknown> | null
  viewCount: number
  createdAt: string
  updatedAt: string
  fields?: Field[]
  _count?: {
    fields: number
    responses: number
  }
}

interface FormsListResponse {
  forms: Form[]
}

interface FormResponse {
  form: Form
}

/**
 * What the anonymous endpoint returns, which is a form **plus one boolean**.
 *
 * `showBranding` is the only thing about the owner's plan that crosses this
 * boundary (features/0014). Anyone holding a share link receives this payload,
 * so it deliberately carries no plan name, no limit, no usage and no
 * organization id — the same reason the response limit answers `404` there
 * instead of `402`.
 */
export interface PublicForm {
  form: Form
  showBranding: boolean
}

interface PublicFormResponse {
  form: Form
  showBranding?: boolean
}

export interface CreateFormData {
  title: string
  description?: string
  pdfUrl?: string
}

export interface UpdateFormData {
  title?: string
  description?: string
  status?: FormStatus
  pdfUrl?: string
  settings?: Record<string, unknown>
}

export const formsService = {
  async list(): Promise<Form[]> {
    const response = await api.get<FormsListResponse>('/forms')
    return response.forms
  },

  async get(id: string): Promise<Form> {
    const response = await api.get<FormResponse>(`/forms/${id}`)
    return response.form
  },

  async create(data: CreateFormData): Promise<Form> {
    const response = await api.post<FormResponse>('/forms', data)
    return response.form
  },

  async update(id: string, data: UpdateFormData): Promise<Form> {
    const response = await api.put<FormResponse>(`/forms/${id}`, data)
    return response.form
  },

  async updateStatus(id: string, status: FormStatus): Promise<Form> {
    const response = await api.patch<FormResponse>(`/forms/${id}/status`, { status })
    return response.form
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/forms/${id}`)
  },

  async getPublic(shareId: string): Promise<PublicForm> {
    const response = await api.get<PublicFormResponse>(`/forms/public/${shareId}`)
    return {
      form: response.form,
      // Absent means shown. The safe direction for a missing flag is to keep
      // the mark: an older server, a proxy that drops it, or a shape change
      // must never silently give away the paid tier's benefit.
      showBranding: response.showBranding ?? true
    }
  }
}
