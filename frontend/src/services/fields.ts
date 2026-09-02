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

/** The server's answer to "may this pattern be stored". */
export type PatternCheckResult = { ok: true } | { ok: false; reason: string }

export const fieldsService = {
  /**
   * Asks whether a pattern is storable, before anything is saved
   * (features/0036).
   *
   * **Only the server can answer this.** RE2 and JavaScript disagree in both
   * directions — RE2 rejects lookahead and backreferences that JavaScript
   * accepts, and accepts `(?P<n>a)` that JavaScript rejects — so checking it
   * here would be a second source of truth that drifts from the engine.
   *
   * Note what it does **not** tell you: whether the pattern is fast enough to
   * run in a respondent's browser. RE2 is linear, so `^(a+)+$` is perfectly
   * acceptable to it; that half is `describePattern` in `pattern-check.ts`.
   */
  async checkPattern(pattern: string): Promise<PatternCheckResult> {
    return api.post<PatternCheckResult>('/forms/fields/check-pattern', { pattern })
  },

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
