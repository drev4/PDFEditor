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

/**
 * The bulk save is the only endpoint that accepts an `id`. Sending back the id
 * the server gave us is what makes a save a diff instead of a delete-and-
 * recreate; without it the server cannot tell an edited field from a new one,
 * and the answers attached to the old row are lost.
 * Omit `id` for fields that only exist locally and have never been saved.
 */
export interface BulkFieldData extends CreateFieldData {
  id?: string
}

interface FieldResponse {
  field: Field
}

interface BulkFieldsResponse {
  fields: Field[]
  /** Ids of fields that were removed in the editor but kept because they hold responses. */
  archived: string[]
}

export interface BulkSaveResult {
  fields: Field[]
  archived: string[]
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

  async bulkSave(formId: string, fields: BulkFieldData[]): Promise<BulkSaveResult> {
    const response = await api.post<BulkFieldsResponse>(`/forms/${formId}/fields/bulk`, { fields })
    return { fields: response.fields, archived: response.archived ?? [] }
  }
}
