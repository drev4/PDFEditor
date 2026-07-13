import { api } from './api'
import type { Field } from './forms'

export interface CreateFieldData {
  type: 'text' | 'textarea' | 'checkbox' | 'radio' | 'dropdown'
  name: string
  label: string
  required: boolean
  position: {
    x: number
    y: number
    width: number
    height: number
    page: number
  }
  options?: string[]
  validation?: {
    minLength?: number
    maxLength?: number
    pattern?: string
  }
  order: number
}

export interface UpdateFieldData extends Partial<CreateFieldData> {}

interface FieldResponse {
  field: Field
}

interface BulkFieldsResponse {
  fields: Field[]
}

export const fieldsService = {
  async create(formId: string, data: CreateFieldData): Promise<Field> {
    const response = await api.post<FieldResponse>(`/forms/${formId}/fields`, data)
    return response.field
  },

  async update(formId: string, fieldId: string, data: UpdateFieldData): Promise<Field> {
    const response = await api.put<FieldResponse>(`/forms/${formId}/fields/${fieldId}`, data)
    return response.field
  },

  async delete(formId: string, fieldId: string): Promise<void> {
    await api.delete(`/forms/${formId}/fields/${fieldId}`)
  },

  async bulkSave(formId: string, fields: CreateFieldData[]): Promise<Field[]> {
    const response = await api.post<BulkFieldsResponse>(`/forms/${formId}/fields/bulk`, { fields })
    return response.fields
  }
}
