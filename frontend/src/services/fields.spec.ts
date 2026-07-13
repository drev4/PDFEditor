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
      vi.mocked(api.post).mockResolvedValue({ fields: [mockField, { ...mockField, id: 'field-2' }] })

      const fields = await fieldsService.bulkSave('form-1', [mockFieldData, mockFieldData])

      expect(api.post).toHaveBeenCalledWith('/forms/form-1/fields/bulk', {
        fields: [mockFieldData, mockFieldData]
      })
      expect(fields).toHaveLength(2)
    })
  })
})
