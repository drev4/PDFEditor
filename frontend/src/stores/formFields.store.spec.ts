import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFormFieldsStore, type FormField } from './formFields.store'
import { fieldsService } from '@/services/fields'

vi.mock('@/services/fields')

describe('FormFields Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  const mockField: Omit<FormField, 'id'> = {
    type: 'text',
    name: 'field1',
    label: 'Field 1',
    required: false,
    border: true,
    position: { x: 10, y: 20, width: 100, height: 30, page: 1 }
  }

  describe('Local Field Operations', () => {
    it('should add field', () => {
      const store = useFormFieldsStore()

      const field = store.addField(mockField)

      expect(store.fields).toHaveLength(1)
      expect(field.id).toBeDefined()
      expect(field.name).toBe('field1')
      expect(store.selectedFieldId).toBe(field.id)
    })

    it('should update field', () => {
      const store = useFormFieldsStore()
      const field = store.addField(mockField)

      store.updateField(field.id, { label: 'Updated Label' })

      expect(store.fields[0]?.label).toBe('Updated Label')
    })

    it('should delete field', () => {
      const store = useFormFieldsStore()
      const field = store.addField(mockField)

      store.deleteField(field.id)

      expect(store.fields).toHaveLength(0)
      expect(store.selectedFieldId).toBeNull()
    })

    it('should select field', () => {
      const store = useFormFieldsStore()
      const field = store.addField(mockField)

      store.selectField(field.id)

      expect(store.selectedFieldId).toBe(field.id)
      expect(store.selectedField?.id).toBe(field.id)
    })

    it('should move field', () => {
      const store = useFormFieldsStore()
      const field = store.addField(mockField)

      store.moveField(field.id, 50, 60)

      expect(store.fields[0]?.position.x).toBe(50)
      expect(store.fields[0]?.position.y).toBe(60)
    })

    it('should resize field', () => {
      const store = useFormFieldsStore()
      const field = store.addField(mockField)

      store.resizeField(field.id, 200, 40)

      expect(store.fields[0]?.position.width).toBe(200)
      expect(store.fields[0]?.position.height).toBe(40)
    })
  })

  describe('Field Management', () => {
    it('should generate unique field name', () => {
      const store = useFormFieldsStore()
      store.addField({ ...mockField, name: 'text_1' })

      const name = store.generateUniqueFieldName('text')

      expect(name).toBe('text_2')
    })

    it('should check if field exists', () => {
      const store = useFormFieldsStore()
      store.addField({ ...mockField, name: 'field1' })

      expect(store.fieldExists('field1')).toBe(true)
      expect(store.fieldExists('field2')).toBe(false)
    })

    it('should prevent duplicate field names', () => {
      const store = useFormFieldsStore()
      const field1 = store.addField({ ...mockField, name: 'field1' })
      store.addField({ ...mockField, name: 'field2' })

      store.updateField(field1.id, { name: 'field2' })

      expect(store.fields[0]?.name).toBe('field1')
    })
  })

  describe('Server Persistence', () => {
    it('should save all fields', async () => {
      const store = useFormFieldsStore()
      store.setCurrentForm('form-1')
      store.addField(mockField)

      vi.mocked(fieldsService.bulkSave).mockResolvedValue({
        fields: [
          { id: 'field-id', formId: 'form-1', ...mockField, order: 0, createdAt: '2024-01-01' }
        ],
        archived: []
      } as any)

      await store.saveAllFields()

      expect(fieldsService.bulkSave).toHaveBeenCalledWith('form-1', expect.any(Array))
      expect(store.loading).toBe(false)
    })

    // Sending the server id back is what makes the save a diff instead of a
    // delete-and-recreate. Dropping it is what destroyed collected answers.
    it('should send server ids and omit locally-created ones', async () => {
      const store = useFormFieldsStore()
      store.setCurrentForm('form-1')

      const serverFieldId = '550e8400-e29b-41d4-a716-446655440000'
      store.fields.push({ ...mockField, id: serverFieldId, name: 'saved' })
      const localField = store.addField({ ...mockField, name: 'brand_new' })

      vi.mocked(fieldsService.bulkSave).mockResolvedValue({ fields: [], archived: [] } as any)

      await store.saveAllFields()

      const payload = vi.mocked(fieldsService.bulkSave).mock.calls[0]![1]
      expect(payload).toHaveLength(2)

      const saved = payload.find(f => f.name === 'saved')
      expect(saved?.id).toBe(serverFieldId)

      const created = payload.find(f => f.name === 'brand_new')
      expect(created).toBeDefined()
      expect('id' in created!).toBe(false)
      expect(localField.id.startsWith('field-')).toBe(true)
    })

    it('should expose fields the server archived because they hold responses', async () => {
      const store = useFormFieldsStore()
      store.setCurrentForm('form-1')
      store.addField(mockField)

      vi.mocked(fieldsService.bulkSave).mockResolvedValue({
        fields: [],
        archived: ['550e8400-e29b-41d4-a716-446655440000']
      } as any)

      await store.saveAllFields()

      expect(store.archivedFieldIds).toEqual(['550e8400-e29b-41d4-a716-446655440000'])

      store.clearArchivedFieldIds()
      expect(store.archivedFieldIds).toEqual([])
    })

    it('should handle save error', async () => {
      const store = useFormFieldsStore()
      store.setCurrentForm('form-1')

      vi.mocked(fieldsService.bulkSave).mockRejectedValue(new Error('Save failed'))

      await expect(store.saveAllFields()).rejects.toThrow()
      expect(store.error).toBeTruthy()
    })

    it('should delete field from server', async () => {
      const store = useFormFieldsStore()
      store.setCurrentForm('form-1')
      const serverFieldId = '550e8400-e29b-41d4-a716-446655440000'
      store.fields.push({ ...mockField, id: serverFieldId })

      vi.mocked(fieldsService.delete).mockResolvedValue({
        message: 'Field archived',
        archived: true,
        answerCount: 3
      })

      const result = await store.deleteFieldFromServer(serverFieldId)

      expect(fieldsService.delete).toHaveBeenCalledWith('form-1', serverFieldId)
      expect(store.fields).toHaveLength(0)
      // The server's answer reaches the caller: only it knows whether the field
      // was archived and how many responses that kept (features/0044).
      expect(result).toEqual({ message: 'Field archived', archived: true, answerCount: 3 })
    })
  })

  describe('Computed Properties', () => {
    it('should group fields by page', () => {
      const store = useFormFieldsStore()
      store.addField({ ...mockField, position: { ...mockField.position, page: 1 } })
      store.addField({ ...mockField, position: { ...mockField.position, page: 2 } })
      store.addField({ ...mockField, position: { ...mockField.position, page: 1 } })

      const byPage = store.fieldsByPage

      expect(byPage[1]).toHaveLength(2)
      expect(byPage[2]).toHaveLength(1)
    })
  })

  // Archived fields (features/0045). The tests that matter here are about the
  // restored field landing in `fields`: the bulk save reads its removals as
  // "a live field whose id is missing from the payload", so a restore that
  // only refreshes the sidebar is undone by the next save with no error.
  describe('Archived fields', () => {
    const archivedRow = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      formId: 'form-1',
      type: 'text' as const,
      name: 'old_question',
      label: 'Old question',
      required: false,
      position: { x: 5, y: 6, width: 80, height: 20, page: 2 },
      order: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      deletedAt: '2026-02-01T00:00:00.000Z',
      answerCount: 4
    }

    it('loads the archived list for the current form', async () => {
      const store = useFormFieldsStore()
      store.setCurrentForm('form-1')
      vi.mocked(fieldsService.listArchived).mockResolvedValue([archivedRow] as any)

      await store.loadArchivedFields()

      expect(fieldsService.listArchived).toHaveBeenCalledWith('form-1')
      expect(store.archivedFields).toHaveLength(1)
      expect(store.archivedFields[0]?.answerCount).toBe(4)
    })

    it('does not ask for a list when no form is open', async () => {
      const store = useFormFieldsStore()

      await store.loadArchivedFields()

      expect(fieldsService.listArchived).not.toHaveBeenCalled()
    })

    it('puts a restored field into the editor list, with its server id', async () => {
      const store = useFormFieldsStore()
      store.setCurrentForm('form-1')
      store.archivedFields = [archivedRow] as any
      vi.mocked(fieldsService.restore).mockResolvedValue({ ...archivedRow, deletedAt: null } as any)

      await store.restoreArchivedField(archivedRow.id)

      expect(fieldsService.restore).toHaveBeenCalledWith('form-1', archivedRow.id)
      expect(store.fields.map(f => f.id)).toContain(archivedRow.id)
      expect(store.fields[0]?.position).toEqual(archivedRow.position)
      expect(store.archivedFields).toEqual([])
    })

    // The regression this whole feature turns on: a restored field that is not
    // in `fields` is left out of the next bulk save payload, and the server
    // archives it again.
    it('sends the restored field back with the next save', async () => {
      const store = useFormFieldsStore()
      store.setCurrentForm('form-1')
      vi.mocked(fieldsService.restore).mockResolvedValue({ ...archivedRow, deletedAt: null } as any)
      vi.mocked(fieldsService.bulkSave).mockResolvedValue({ fields: [], archived: [] } as any)

      await store.restoreArchivedField(archivedRow.id)
      await store.saveAllFields()

      const payload = vi.mocked(fieldsService.bulkSave).mock.calls[0]?.[1] ?? []
      expect(payload.map(f => f.id)).toContain(archivedRow.id)
    })

    it('does not mark the document dirty - the restore already reached the server', async () => {
      const store = useFormFieldsStore()
      store.setCurrentForm('form-1')
      vi.mocked(fieldsService.restore).mockResolvedValue({ ...archivedRow, deletedAt: null } as any)

      await store.restoreArchivedField(archivedRow.id)

      expect(store.hasUnsavedChanges).toBe(false)
    })

    it('reloads the archived list after a save that archived something', async () => {
      const store = useFormFieldsStore()
      store.setCurrentForm('form-1')
      store.addField(mockField)
      vi.mocked(fieldsService.bulkSave).mockResolvedValue({ fields: [], archived: [archivedRow.id] } as any)
      vi.mocked(fieldsService.listArchived).mockResolvedValue([archivedRow] as any)

      await store.saveAllFields()

      expect(fieldsService.listArchived).toHaveBeenCalledWith('form-1')
      expect(store.archivedFields).toHaveLength(1)
    })

    it('does not spend a request when a save archived nothing', async () => {
      const store = useFormFieldsStore()
      store.setCurrentForm('form-1')
      store.addField(mockField)
      vi.mocked(fieldsService.bulkSave).mockResolvedValue({ fields: [], archived: [] } as any)

      await store.saveAllFields()

      expect(fieldsService.listArchived).not.toHaveBeenCalled()
    })
  })

})
