# Testing Documentation

## Overview

This directory contains all testing configuration, mocks, and helpers for the VuePDF application.

## Structure

```
src/test/
├── setup.ts              # Global test setup (mocks, config)
├── mocks/               # Mock implementations
│   ├── pdfjs.mock.ts   # PDF.js mocking
│   └── pdflib.mock.ts  # pdf-lib mocking
└── helpers/            # Test utilities
    ├── test-utils.ts   # Common test helpers
    └── pinia-setup.ts  # Pinia store setup
```

## Available Mocks

### PDF.js Mock (`pdfjs.mock.ts`)
- `createMockPDFDocument()` - Creates a mock PDF document
- `mockGetDocument` - Mocked getDocument function
- `mockPDFJS` - Complete PDF.js module mock

### PDF-lib Mock (`pdflib.mock.ts`)
- `createMockPDFLibDocument()` - Creates a mock PDF-lib document
- `mockPDFLib` - Complete pdf-lib module mock

## Test Helpers

### `test-utils.ts`
- `createMockPDFFile()` - Create mock PDF File objects
- `createMockPDFDocument()` - Create mock PDFDocument for stores
- `createMockSearchMatches()` - Create mock search results
- `createMockEditAction()` - Create mock edit actions
- `createMockCanvas()` - Create mock canvas element
- `flushPromises()` - Wait for async operations

### `pinia-setup.ts`
- `setupPinia()` - Setup Pinia for testing
- `resetStores()` - Reset stores between tests

## Usage Examples

### Testing a Pinia Store

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { setupPinia } from '@/test/helpers/pinia-setup'
import { useDocumentStore } from '@/stores/document.store'
import { createMockPDFFile } from '@/test/helpers/test-utils'

describe('DocumentStore', () => {
  beforeEach(() => {
    setupPinia()
  })

  it('loads a PDF file', async () => {
    const store = useDocumentStore()
    const file = createMockPDFFile()

    await store.loadPDF(file)

    expect(store.documents).toHaveLength(1)
    expect(store.activeDocumentId).toBeTruthy()
  })
})
```

### Testing a Vue Component

```typescript
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MyComponent from '@/components/MyComponent.vue'

describe('MyComponent', () => {
  it('renders correctly', () => {
    const wrapper = mount(MyComponent, {
      props: { title: 'Test' }
    })

    expect(wrapper.text()).toContain('Test')
  })
})
```

### Testing with PDF.js

```typescript
import { vi } from 'vitest'
import { createMockPDFDocument } from '@/test/mocks/pdfjs.mock'

vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn().mockImplementation(() => ({
    promise: Promise.resolve(createMockPDFDocument())
  })),
  GlobalWorkerOptions: { workerSrc: '/mock/worker.js' }
}))
```

## Global Setup

The `setup.ts` file provides:
- Window mocks (matchMedia, IntersectionObserver, ResizeObserver)
- Canvas API mocks for PDF rendering
- URL mocks for blob handling
- Vue Test Utils configuration

These are automatically loaded before all tests run.
