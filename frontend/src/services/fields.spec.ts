import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fieldsService } from './fields'
import { api } from './api'

vi.mock('./api')

describe('Fields Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mockField = {
    id: 'field-1',
    formId: 'form-1',
    type: 'text' as const,
    name: 'field1',
    label: 'Field 1',
    required: false,
    position: { x: 10, y: 20, width: 100, height: 30, page: 1 },
    order: 0,
    createdAt: '2024-01-01'
  }

  const mockFieldData = {
    type: 'text' as const,
    name: 'field1',
    label: 'Field 1',
    required: false,
    position: { x: 10, y: 20, width: 100, height: 30, page: 1 },
    order: 0
  }

  describe('create', () => {
    it('should create new field', async () => {
      vi.mocked(api.post).mockResolvedValue({ field: mockField })

      const field = await fieldsService.create('form-1', mockFieldData)

      expect(api.post).toHaveBeenCalledWith('/forms/form-1/fields', mockFieldData)
      expect(field.id).toBe('field-1')
    })
  })

  describe('update', () => {
    it('should update field', async () => {
      const updatedField = { ...mockField, label: 'Updated' }
      vi.mocked(api.put).mockResolvedValue({ field: updatedField })

      const field = await fieldsService.update('form-1', 'field-1', { label: 'Updated' })

      expect(api.put).toHaveBeenCalledWith('/forms/form-1/fields/field-1', { label: 'Updated' })
      expect(field.label).toBe('Updated')
    })
  })

  describe('delete', () => {
    it('should delete field', async () => {
      vi.mocked(api.delete).mockResolvedValue({})

      await fieldsService.delete('form-1', 'field-1')

      expect(api.delete).toHaveBeenCalledWith('/forms/form-1/fields/field-1')
    })
  })

  describe('bulkSave', () => {
    it('should bulk save fields', async () => {
      vi.mocked(api.post).mockResolvedValue({
        fields: [mockField, { ...mockField, id: 'field-2' }],
        archived: []
      })

      const result = await fieldsService.bulkSave('form-1', [mockFieldData, mockFieldData])

      expect(api.post).toHaveBeenCalledWith('/forms/form-1/fields/bulk', {
        fields: [mockFieldData, mockFieldData]
      })
      expect(result.fields).toHaveLength(2)
      expect(result.archived).toEqual([])
    })

    it('should pass through field ids so the save is a diff, not a replacement', async () => {
      vi.mocked(api.post).mockResolvedValue({ fields: [mockField], archived: [] })

      const withId = { ...mockFieldData, id: 'server-field-1' }
      await fieldsService.bulkSave('form-1', [withId])

      expect(api.post).toHaveBeenCalledWith('/forms/form-1/fields/bulk', { fields: [withId] })
    })

    it('should surface the ids the server archived', async () => {
      vi.mocked(api.post).mockResolvedValue({ fields: [], archived: ['field-9'] })

      const result = await fieldsService.bulkSave('form-1', [])

      expect(result.archived).toEqual(['field-9'])
    })

    it('should default archived to an empty array if the server omits it', async () => {
      vi.mocked(api.post).mockResolvedValue({ fields: [] })

      const result = await fieldsService.bulkSave('form-1', [])

      expect(result.archived).toEqual([])
    })
  })
})
