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
  userId: string
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

  async delete(id: string): Promise<void> {
    await api.delete(`/forms/${id}`)
  },

  async getPublic(shareId: string): Promise<Form> {
    const response = await api.get<FormResponse>(`/forms/public/${shareId}`)
    return response.form
  }
}
