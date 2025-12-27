# Guía de Testing para Contribuidores

Esta guía te ayudará a entender cómo escribir y mantener tests en el proyecto VuePDF.

## Filosofía de Testing

Seguimos un enfoque **pragmático** de testing:

- **Calidad sobre cantidad** - No buscamos 100% de cobertura
- **Testing de comportamiento** - No de implementación
- **Tests concisos** - Máximo 150 líneas por archivo
- **Enfoque en lo crítico** - Stores > Composables > Componentes

## Antes de Escribir un Test

Pregúntate:

1. ¿Verifica comportamiento o implementación? → Solo comportamiento
2. ¿Si falla, indica un bug real? → Si no, no lo escribas
3. ¿Puedo combinar con otro test? → Hazlo
4. ¿Ya existe un test similar? → Evita duplicados
5. ¿Es un componente crítico? → Si no, tal vez no necesita tests

## Qué Testear

### SÍ testear

- Lógica de negocio (cálculos, transformaciones)
- Validaciones (formularios, inputs)
- Estados críticos (loading, error, success)
- Flujos del usuario (navegación, formularios)
- Edge cases reales (lista vacía, permisos)
- API calls (mockeadas)

### NO testear

- Librerías de terceros (Vue Router, Pinia, PDF.js)
- CSS y estilos (apariencia visual)
- Props que solo pasan data sin lógica
- Cada variación de texto
- Nombres de métodos internos
- Getters triviales
- Props opcionales no críticas

## Estructura de Tests por Tipo

### Stores (Prioridad Alta)

**Objetivo:** 85-95% cobertura

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useMyStore } from './my.store'

describe('MyStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('inicializa con estado por defecto', () => {
    const store = useMyStore()
    expect(store.myState).toBe(expectedValue)
  })

  it('acción principal modifica estado', () => {
    const store = useMyStore()
    store.mainAction()
    expect(store.myState).toBe(newValue)
  })
})
```

**Número de tests:** 10-15 tests

### Composables (Prioridad Media-Alta)

**Objetivo:** 70-80% en composables con lógica de negocio

```typescript
import { describe, it, expect } from 'vitest'
import { useMyComposable } from './useMyComposable'

describe('useMyComposable', () => {
  it('funcionalidad principal', () => {
    const { data, action } = useMyComposable()
    action()
    expect(data.value).toBe(expected)
  })
})
```

**Número de tests:** 8-12 tests para composables críticos

### Componentes (Prioridad Selectiva)

#### Componentes Críticos (100% cobertura)

Ejemplos: FileUploader, PDFToolbar, SearchSpotlight

```typescript
import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/vue'
import MyComponent from './MyComponent.vue'

describe('MyComponent', () => {
  it('renderiza y maneja interacción principal', async () => {
    const { getByRole } = render(MyComponent)
    const button = getByRole('button')
    await fireEvent.click(button)
    expect(button).toHaveTextContent('Clicked')
  })
})
```

**Número de tests:** 8-10 tests

#### Componentes Medios (50-70% cobertura)

Ejemplos: PDFViewer, PageThumbnails

```typescript
describe('MyComponent', () => {
  it('renderiza correctamente', () => {})
  it('maneja estado loading', () => {})
  it('maneja errores', () => {})
})
```

**Número de tests:** 5-7 tests

#### Componentes Simples (0-30% cobertura o sin tests)

Ejemplos: DrawingToolbar, ImageControls, TextControls

**No requieren tests exhaustivos** - Son principalmente visuales o dependen de interacciones complejas del DOM.

## Comandos de Desarrollo

### Desarrollo Diario

```bash
# Watch mode mientras programas
npm run test -- --watch

# Solo tests relacionados a cambios
npm run test -- --changed

# Test específico
npm run test MyComponent
```

### Antes de Commit

```bash
# Ejecutar todos los tests
npm run test

# Ver coverage
npm run test:coverage
```

### Debugging

```bash
# UI interactiva de Vitest
npm run test:ui

# Modo debug con breakpoints
npm run test -- --inspect-brk
```

## Reglas de Estilo

### 1. Nombres Descriptivos

```typescript
// ✅ BUENO
it('valida email y muestra error si es inválido', () => {})

// ❌ MALO
it('test de email', () => {})
```

### 2. Arrange-Act-Assert

```typescript
it('incrementa contador al hacer click', async () => {
  // Arrange - Preparar
  const { getByRole } = render(Counter)

  // Act - Actuar
  await fireEvent.click(getByRole('button'))

  // Assert - Verificar
  expect(getByRole('button')).toHaveTextContent('1')
})
```

### 3. Combinar Tests Relacionados

```typescript
// ✅ BUENO - Un test
it('valida email requerido y formato', async () => {
  // Test both validations
})

// ❌ MALO - Dos tests separados innecesarios
it('valida email requerido', () => {})
it('valida formato de email', () => {})
```

### 4. Máximo 30 Líneas por Test

Si un test supera 30 líneas, probablemente el componente es muy complejo o el test verifica demasiadas cosas.

## Mocking

### PDF.js (ya configurado globalmente)

```typescript
// No necesitas hacer nada, el mock está en setup.ts
import * as pdfjsLib from 'pdfjs-dist'

// El mock ya está activo
```

### Canvas (ya configurado globalmente)

```typescript
// Canvas está mockeado en setup.ts
const canvas = document.createElement('canvas')
const ctx = canvas.getContext('2d')
// ctx ya tiene mocks de fillRect, strokeRect, etc.
```

### API Calls

```typescript
import { vi } from 'vitest'

// Mock de fetch
global.fetch = vi.fn(() =>
  Promise.resolve({
    json: () => Promise.resolve({ data: 'test' })
  })
)
```

## Checklist para PRs

Antes de crear un PR:

- [ ] Todos los tests pasan (`npm run test`)
- [ ] No hay tests skipeados sin justificación (`it.skip`, `describe.skip`)
- [ ] Coverage no disminuyó en archivos críticos
- [ ] Tests nuevos siguen las guías de estilo
- [ ] Tests son concisos (máx 150 líneas por archivo)
- [ ] Se agregaron tests solo donde son necesarios

## Objetivos de Cobertura

No te obsesiones con alcanzar 100% en todo:

| Tipo | Objetivo | Justificación |
|------|----------|---------------|
| Stores | 85-95% | Críticos para estado global |
| Composables de negocio | 70-80% | Lógica importante |
| Composables UI | 0-30% | Helpers visuales, no críticos |
| Componentes críticos | 80-100% | FileUploader, Toolbars, Search |
| Componentes medios | 50-70% | Viewers, Lists |
| Componentes UI simples | 0-30% | Botones, Cards, Badges |

**Global: 70-80% es excelente**

## Ejemplos Completos

### Store Completo

Ver: `src/stores/search.store.spec.ts` (100% cobertura, 11 tests)

### Composable Completo

Ver: `src/composables/useThumbnails.spec.ts` (97% cobertura, 10 tests)

### Componente Crítico

Ver: `src/components/ui/FileUploader.spec.ts` (100% cobertura, 4 tests)

### Componente Medio

Ver: `src/components/pdf/PDFViewer.spec.ts` (54% cobertura, 9 tests)

## Debugging de Tests Fallidos

### 1. Ver HTML Renderizado

```typescript
const wrapper = mount(MyComponent)
console.log(wrapper.html())
```

### 2. Ver Props

```typescript
console.log(wrapper.props())
```

### 3. Ver Eventos Emitidos

```typescript
console.log(wrapper.emitted())
```

### 4. Usar UI de Vitest

```bash
npm run test:ui
# Navega a http://localhost:51204/__vitest__/
```

## Problemas Comunes

### "Cannot find module 'pdfjs-dist'"

El mock está en `setup.ts`. Asegúrate de que Vitest está usando el setup:

```typescript
// vitest.config.ts
setupFiles: ['./src/test/setup.ts']
```

### "canvas.getContext is not a function"

El mock de canvas está en `setup.ts`. Verifica que se está ejecutando.

### "Warning: not wrapped in act()"

Usa `await` en acciones asíncronas:

```typescript
// ✅ BUENO
await fireEvent.click(button)

// ❌ MALO
fireEvent.click(button)
```

## Recursos

- [Vitest Docs](https://vitest.dev/)
- [@vue/test-utils](https://test-utils.vuejs.org/)
- [Testing Library](https://testing-library.com/docs/vue-testing-library/intro/)
- [Testing Report](./TESTING_REPORT.md) - Reporte completo del proyecto

## Contacto

Si tienes dudas sobre testing, revisa:
1. Este documento
2. TESTING_REPORT.md
3. Los ejemplos en los archivos `.spec.ts` existentes
4. Abre un issue en GitHub

---

**Recuerda:** Testing efectivo ≠ Testing exhaustivo. Calidad > Cantidad.
