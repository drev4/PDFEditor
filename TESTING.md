# Testing Guide - VuePDF

## Quick Start

```bash
# Run all tests
npm test

# Run tests in watch mode (development)
npm test

# Run tests once (CI mode)
npm run test:run

# Run tests with UI
npm run test:ui

# Generate coverage report
npm run test:coverage
```

## Test Structure

```
src/
├── test/
│   ├── setup.ts                 # Global test setup
│   ├── example.spec.ts          # Example tests
│   ├── setup-validation.spec.ts # Setup validation
│   ├── mocks/
│   │   ├── pdfjs.mock.ts       # PDF.js mocks
│   │   └── pdflib.mock.ts      # pdf-lib mocks
│   └── helpers/
│       ├── test-utils.ts        # Test utilities
│       └── pinia-setup.ts       # Pinia setup
├── stores/
│   └── *.spec.ts               # Store tests (co-located)
├── composables/
│   └── *.spec.ts               # Composable tests (co-located)
└── components/
    └── **/*.spec.vue           # Component tests (co-located)
```

## Writing Tests

### Testing a Store

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { setupPinia } from '@/test/helpers/pinia-setup'
import { useDocumentStore } from '@/stores/document.store'
import { createMockPDFFile } from '@/test/helpers/test-utils'

describe('DocumentStore', () => {
  beforeEach(() => {
    setupPinia()
  })

  it('should load a PDF file', async () => {
    const store = useDocumentStore()
    const file = createMockPDFFile()

    await store.loadPDF(file)

    expect(store.documents).toHaveLength(1)
    expect(store.activeDocumentId).toBeTruthy()
  })
})
```

### Testing a Component

```typescript
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import FileUploader from '@/components/ui/FileUploader.vue'

describe('FileUploader', () => {
  it('should render upload button', () => {
    const wrapper = mount(FileUploader)
    expect(wrapper.find('button').exists()).toBe(true)
  })
})
```

### Testing a Composable

```typescript
import { describe, it, expect } from 'vitest'
import { useThumbnails } from '@/composables/useThumbnails'
import { createMockPDFDocument } from '@/test/mocks/pdfjs.mock'

describe('useThumbnails', () => {
  it('should generate thumbnail', async () => {
    const { generateThumbnail } = useThumbnails()
    const pdfDoc = createMockPDFDocument()

    const thumbnail = await generateThumbnail(pdfDoc, 1)

    expect(thumbnail).toBeTruthy()
  })
})
```

## Available Mocks

### Global Mocks (Auto-loaded)
- `localStorage` / `sessionStorage`
- `window.matchMedia`
- `IntersectionObserver`
- `ResizeObserver`
- Canvas API (`getContext`, `toDataURL`)
- `URL.createObjectURL` / `revokeObjectURL`

### PDF Mocks
- `createMockPDFDocument()` - Mock PDF.js document
- `mockGetDocument` - Mock PDF.js getDocument function
- `createMockPDFLibDocument()` - Mock pdf-lib document

### Test Utilities
- `createMockPDFFile()` - Create mock File object
- `createMockPDFDocument()` - Create mock PDFDocument
- `createMockSearchMatches()` - Create mock search results
- `createMockCanvas()` - Create mock canvas element
- `flushPromises()` - Wait for async operations

## Coverage Goals

- **Stores**: 85-95% (critical business logic)
- **Composables**: 80-90% (core functionality)
- **Components**: 70-80% (user interactions)
- **Overall**: 75-80%

## Best Practices

1. **Test behavior, not implementation**
   - Focus on what the code does, not how it does it
   - Test user interactions and outcomes

2. **Keep tests simple and focused**
   - One concept per test
   - Clear test names that describe the behavior

3. **Use test helpers**
   - Don't repeat setup code
   - Use provided mocks and utilities

4. **Mock external dependencies**
   - PDF.js, pdf-lib are already mocked
   - Use `vi.mock()` for other external libraries

5. **Clean up between tests**
   - Use `beforeEach` to reset state
   - Pinia stores are automatically reset

## CI/CD Integration

Tests run automatically on:
- Every commit (when configured)
- Pull requests
- Before deployment

## Troubleshooting

### Tests fail with "localStorage is not defined"
- Already fixed in setup.ts

### Canvas-related errors
- Canvas API is mocked in setup.ts
- Use `createMockCanvas()` for custom canvas tests

### PDF.js errors
- Use mocks from `@/test/mocks/pdfjs.mock.ts`
- Example:
  ```typescript
  vi.mock('pdfjs-dist', () => import('@/test/mocks/pdfjs.mock'))
  ```

### Pinia store not found
- Make sure to call `setupPinia()` in `beforeEach`

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Vue Test Utils](https://test-utils.vuejs.org/)
- [Testing Library](https://testing-library.com/docs/vue-testing-library/intro/)
- Project test examples: `src/test/`

## Next Steps

After Phase 2 setup, we'll proceed to:
- Phase 3: Test critical stores and components
- Phase 4: Test composables
- Phase 5: Test remaining components
- Phase 6: Final coverage report
