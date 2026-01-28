import { vi } from 'vitest'
import type { PDFDocument, SearchMatch, EditAction } from '@/types/pdf'

/**
 * Create a mock PDF File object with arrayBuffer support
 */
export const createMockPDFFile = (name = 'test.pdf', size = 1024): File => {
  const arrayBuffer = new ArrayBuffer(size)
  const blob = new Blob([arrayBuffer], { type: 'application/pdf' })

  // Create a proper File object
  const file = new File([blob], name, { type: 'application/pdf' })

  // Override arrayBuffer to return the mock buffer
  Object.defineProperty(file, 'arrayBuffer', {
    value: vi.fn().mockResolvedValue(arrayBuffer),
    writable: true
  })

  return file
}

/**
 * Create a mock PDF Document for store testing
 */
export const createMockPDFDocument = (overrides: Partial<PDFDocument> = {}): PDFDocument => {
  const mockFile = createMockPDFFile()
  const mockArrayBuffer = new ArrayBuffer(100)

  return {
    id: 'test-doc-123',
    name: 'test.pdf',
    file: mockFile,
    arrayBuffer: mockArrayBuffer,
    numPages: 5,
    currentPage: 1,
    scale: 1.5,
    rotation: 0,
    snapshots: [],
    pageOrder: undefined,
    ...overrides
  }
}

/**
 * Create mock search matches
 */
export const createMockSearchMatches = (count = 3): SearchMatch[] => {
  return Array.from({ length: count }, (_, i) => ({
    pageIndex: Math.floor(i / 2),
    textIndex: i,
    text: `Match ${i + 1}`,
    bounds: {
      x: 100 + i * 10,
      y: 200 + i * 10,
      width: 80,
      height: 12
    }
  }))
}

/**
 * Create mock edit action
 */
export const createMockEditAction = (type: 'text' | 'image' | 'draw' | 'delete' = 'text'): EditAction => ({
  type,
  page: 1,
  data: { content: 'test' },
  timestamp: Date.now()
})

/**
 * Create a mock ArrayBuffer from string
 */
export const createMockArrayBuffer = (content = 'mock content'): ArrayBuffer => {
  const encoder = new TextEncoder()
  return encoder.encode(content).buffer
}

/**
 * Create a mock Image element
 */
export const createMockImage = (width = 100, height = 100): HTMLImageElement => {
  const img = document.createElement('img')
  Object.defineProperty(img, 'width', { value: width, writable: true })
  Object.defineProperty(img, 'height', { value: height, writable: true })
  Object.defineProperty(img, 'src', { value: 'data:image/png;base64,mock', writable: true })
  return img
}

/**
 * Create a mock FileReader
 */
export const createMockFileReader = () => {
  const reader = {
    readAsDataURL: vi.fn(function (this: any, file: File) {
      setTimeout(() => {
        this.onload?.({ target: { result: 'data:image/png;base64,mock' } })
      }, 0)
    }),
    readAsArrayBuffer: vi.fn(function (this: any, file: File) {
      setTimeout(() => {
        this.onload?.({ target: { result: new ArrayBuffer(100) } })
      }, 0)
    }),
    onload: null,
    onerror: null,
    result: null
  }
  return reader
}

/**
 * Wait for next tick (useful for async operations in tests)
 */
export const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0))

/**
 * Mock canvas context for testing
 */
export const createMockCanvasContext = () => ({
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  getImageData: vi.fn(),
  putImageData: vi.fn(),
  createImageData: vi.fn(),
  setTransform: vi.fn(),
  drawImage: vi.fn(),
  save: vi.fn(),
  fillText: vi.fn(),
  restore: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  stroke: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  rotate: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  measureText: vi.fn().mockReturnValue({ width: 100 }),
  transform: vi.fn(),
  rect: vi.fn(),
  clip: vi.fn(),
  fillStyle: '#000000',
  strokeStyle: '#000000',
  lineWidth: 1
})

/**
 * Mock canvas element
 */
export const createMockCanvas = () => {
  const canvas = document.createElement('canvas')
  canvas.width = 800
  canvas.height = 1000
  canvas.getContext = vi.fn().mockReturnValue(createMockCanvasContext())
  return canvas
}
