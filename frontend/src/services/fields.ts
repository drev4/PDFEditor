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

/** What `DELETE /forms/:formId/fields/:fieldId` reports (features/0044). */
export interface DeleteFieldResult {
  message: string
  /** `true` when the field held answers and was archived instead of deleted. */
  archived: boolean
  /** How many answers it held, and therefore how many were kept. */
  answerCount: number
}

/**
 * A field the author removed that the server kept because it holds answers
 * (features/0045).
 *
 * `answerCount` is the server's, not a count of what the responses screen
 * happens to have loaded: that screen holds one page of submissions, and the
 * number worth showing is how many answers this field is keeping in total.
 */
export interface ArchivedField extends Field {
  deletedAt: string
  answerCount: number
}

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

  /**
   * Removing one field.
   *
   * The result is returned rather than discarded because only the server knows
   * which of the two things happened: a field holding answers is archived and a
   * field holding none is deleted (features/0044), and the caller cannot know
   * the count beforehand — the form is published and can take a submission
   * while the author reads the confirmation.
   */
  async delete(formId: string, fieldId: string): Promise<DeleteFieldResult> {
    return api.delete<DeleteFieldResult>(`/forms/${formId}/fields/${fieldId}`)
  },

  /** The fields of this form that were archived rather than deleted. */
  async listArchived(formId: string): Promise<ArchivedField[]> {
    const response = await api.get<{ fields: ArchivedField[] }>(`/forms/${formId}/fields/archived`)
    return response.fields ?? []
  },

  /**
   * Brings an archived field back to life.
   *
   * The **whole row** comes back, not an acknowledgement, and the caller must
   * put it into the editor's field list. The bulk save reads removals as "a
   * live field whose id is missing from the payload", so a restored field left
   * out of that list is archived again by the very next save — silently, with
   * no error for the user to see.
   */
  async restore(formId: string, fieldId: string): Promise<Field> {
    const response = await api.post<FieldResponse>(`/forms/${formId}/fields/${fieldId}/restore`, {})
    return response.field
  },

  async bulkSave(formId: string, fields: BulkFieldData[]): Promise<BulkSaveResult> {
    const response = await api.post<BulkFieldsResponse>(`/forms/${formId}/fields/bulk`, { fields })
    return { fields: response.fields, archived: response.archived ?? [] }
  }
}
