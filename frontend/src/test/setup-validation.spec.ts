import { describe, it, expect, beforeEach } from 'vitest'
import { setupPinia } from '@/test/helpers/pinia-setup'
import {
  createMockPDFFile,
  createMockPDFDocument,
  createMockSearchMatches,
  createMockCanvas
} from '@/test/helpers/test-utils'

/**
 * Validation tests to ensure all test helpers and setup work correctly
 */
describe('Test Setup Validation', () => {
  describe('Pinia Setup', () => {
    beforeEach(() => {
      setupPinia()
    })

    it('should create Pinia instance', () => {
      const pinia = setupPinia()
      expect(pinia).toBeDefined()
    })
  })

  describe('Test Helpers', () => {
    it('should create mock PDF file', () => {
      const file = createMockPDFFile()
      expect(file).toBeDefined()
      expect(file.name).toBe('test.pdf')
      expect(file.type).toBe('application/pdf')
      expect(file.arrayBuffer).toBeDefined()
    })

    it('should create mock PDF document', () => {
      const doc = createMockPDFDocument()
      expect(doc.id).toBeTruthy()
      expect(doc.numPages).toBe(5)
      expect(doc.currentPage).toBe(1)
      expect(doc.scale).toBe(1.5)
    })

    it('should create mock search matches', () => {
      const matches = createMockSearchMatches(3)
      expect(matches).toHaveLength(3)
      expect(matches[0]).toHaveProperty('pageIndex')
      expect(matches[0]).toHaveProperty('bounds')
    })

    it('should create mock canvas', () => {
      const canvas = createMockCanvas()
      expect(canvas).toBeDefined()
      expect(canvas.width).toBe(800)
      expect(canvas.height).toBe(1000)
      expect(canvas.getContext).toBeDefined()
    })
  })

  describe('Canvas Mocking', () => {
    it('should have mocked canvas context', () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')

      expect(ctx).toBeDefined()
      expect(ctx?.fillRect).toBeDefined()
      expect(ctx?.clearRect).toBeDefined()
    })

    it('should have mocked toDataURL', () => {
      const canvas = document.createElement('canvas')
      const dataUrl = canvas.toDataURL()

      expect(dataUrl).toBe('data:image/png;base64,mock')
    })
  })

  describe('Global Mocks', () => {
    it('should have URL.createObjectURL mocked', () => {
      const url = URL.createObjectURL(new Blob())
      expect(url).toBe('blob:mock-url')
    })

    it('should have matchMedia mocked', () => {
      const media = window.matchMedia('(min-width: 768px)')
      expect(media).toBeDefined()
      expect(media.matches).toBe(false)
    })
  })
})
