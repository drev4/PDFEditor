import { describe, it, expect, beforeEach, vi } from 'vitest'
import { formsService } from './forms'
import { api } from './api'

vi.mock('./api')

describe('Forms Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mockForm = {
    id: 'form-1',
    userId: 'user-1',
    title: 'Test Form',
    description: 'Description',
    shareId: 'share-123',
    status: 'draft' as const,
    pdfUrl: null,
    settings: null,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01'
  }

  describe('list', () => {
    it('should fetch all forms', async () => {
      vi.mocked(api.get).mockResolvedValue({ forms: [mockForm] })

      const forms = await formsService.list()

      expect(api.get).toHaveBeenCalledWith('/forms')
      expect(forms).toHaveLength(1)
      expect(forms[0]?.title).toBe('Test Form')
    })
  })

  describe('get', () => {
    it('should fetch single form', async () => {
      vi.mocked(api.get).mockResolvedValue({ form: mockForm })

      const form = await formsService.get('form-1')

      expect(api.get).toHaveBeenCalledWith('/forms/form-1')
      expect(form.id).toBe('form-1')
    })
  })

  describe('create', () => {
    it('should create new form', async () => {
      vi.mocked(api.post).mockResolvedValue({ form: mockForm })

      const form = await formsService.create({
        title: 'New Form',
        description: 'Description'
      })

      expect(api.post).toHaveBeenCalledWith('/forms', {
        title: 'New Form',
        description: 'Description'
      })
      expect(form.title).toBe('Test Form')
    })
  })

  describe('update', () => {
    it('should update form', async () => {
      const updatedForm = { ...mockForm, title: 'Updated' }
      vi.mocked(api.put).mockResolvedValue({ form: updatedForm })

      const form = await formsService.update('form-1', { title: 'Updated' })

      expect(api.put).toHaveBeenCalledWith('/forms/form-1', { title: 'Updated' })
      expect(form.title).toBe('Updated')
    })
  })

  describe('delete', () => {
    it('should delete form', async () => {
      vi.mocked(api.delete).mockResolvedValue({})

      await formsService.delete('form-1')

      expect(api.delete).toHaveBeenCalledWith('/forms/form-1')
    })
  })

  describe('getPublic', () => {
    it('should fetch public form by shareId', async () => {
      vi.mocked(api.get).mockResolvedValue({ form: mockForm })

      const form = await formsService.getPublic('share-123')

      expect(api.get).toHaveBeenCalledWith('/forms/public/share-123')
      expect(form.shareId).toBe('share-123')
    })
  })
})
