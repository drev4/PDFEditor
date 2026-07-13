import { vi } from 'vitest'
import { config } from '@vue/test-utils'

// Mock localStorage
const localStorageMock: Storage = {
  getItem: vi.fn((key: string) => {
    const store: Record<string, string> = {}
    return store[key] || null
  }),
  setItem: vi.fn((key: string, value: string) => {
    const store: Record<string, string> = {}
    store[key] = value
  }),
  removeItem: vi.fn((key: string) => {
    const store: Record<string, string> = {}
    delete store[key]
  }),
  clear: vi.fn(),
  key: vi.fn((index: number) => null),
  length: 0
}

// Create a real storage implementation for tests
let storageData: Record<string, string> = {}

Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: (key: string) => storageData[key] || null,
    setItem: (key: string, value: string) => {
      storageData[key] = value
    },
    removeItem: (key: string) => {
      delete storageData[key]
    },
    clear: () => {
      storageData = {}
    },
    key: (index: number) => null,
    length: 0
  },
  writable: true
})

// Mock sessionStorage
Object.defineProperty(window, 'sessionStorage', {
  value: window.localStorage,
  writable: true
})

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return []
  }
  unobserve() {}
} as any

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
} as any

// Mock canvas for PDF rendering
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
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
  measureText: vi.fn().mockReturnValue({ width: 0 }),
  transform: vi.fn(),
  rect: vi.fn(),
  clip: vi.fn(),
  fillStyle: '',
  strokeStyle: ''
})

HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/png;base64,mock')

// Mock URL.createObjectURL
global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url')
global.URL.revokeObjectURL = vi.fn()

// Mock DOMMatrix for pdfjs-dist
global.DOMMatrix = class DOMMatrix {
  constructor() {}
} as any

// Mock pdfjs-dist
vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: '' },
  version: '5.0.0'
}))

// Mock PrimeVue Toast globally
const mockToast = {
  add: vi.fn(),
  removeGroup: vi.fn(),
  removeAllGroups: vi.fn()
}

vi.mock('primevue/usetoast', () => ({
  useToast: () => mockToast
}))

// Configure Vue Test Utils
config.global.stubs = {
  Teleport: true,
}

// Provide mock toast globally
config.global.provide = {
  toast: mockToast
}

// Suppress console warnings in tests (optional)
global.console.warn = vi.fn()
