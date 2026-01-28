import { vi } from 'vitest'

// Mock PDFDocumentProxy
export const createMockPDFDocument = (numPages = 5) => ({
  numPages,
  _pdfInfo: {
    fingerprints: ['mock-fingerprint-123']
  },
  getPage: vi.fn().mockImplementation(async (pageNum: number) => ({
    pageNumber: pageNum,
    getViewport: vi.fn().mockImplementation(({ scale = 1, rotation = 0 }) => ({
      width: 612 * scale,
      height: 792 * scale,
      scale,
      rotation,
      transform: [scale, 0, 0, scale, 0, 0]
    })),
    render: vi.fn().mockImplementation(({ canvasContext, viewport }) => ({
      promise: Promise.resolve()
    })),
    getTextContent: vi.fn().mockResolvedValue({
      items: [
        {
          str: 'Sample text content',
          transform: [12, 0, 0, 12, 100, 700],
          width: 120,
          height: 12
        },
        {
          str: 'Another line of text',
          transform: [12, 0, 0, 12, 100, 680],
          width: 140,
          height: 12
        }
      ],
      styles: {}
    }),
    cleanup: vi.fn()
  })),
  cleanup: vi.fn(),
  destroy: vi.fn()
})

// Mock PDFjs GlobalWorkerOptions
export const mockGlobalWorkerOptions = {
  workerSrc: '/mock/pdf.worker.js'
}

// Mock getDocument function
export const mockGetDocument = vi.fn().mockImplementation((src: any) => ({
  promise: Promise.resolve(createMockPDFDocument())
}))

// Mock pdfjs-dist module
export const mockPDFJS = {
  getDocument: mockGetDocument,
  GlobalWorkerOptions: mockGlobalWorkerOptions,
  version: '5.0.0',
  PDFWorker: vi.fn()
}

// Export as default for module mock
export default mockPDFJS
