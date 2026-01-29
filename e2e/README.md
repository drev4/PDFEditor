# E2E Tests - VuePDF Forms Platform

Esta carpeta contiene los tests end-to-end (E2E) para VuePDF Forms Platform usando Playwright.

## 📋 Estructura de Tests

### 1. `auth-flow.spec.ts` (6 tests)
Tests del flujo completo de autenticación:
- ✅ Registro de usuario nuevo
- ✅ Login con credenciales existentes
- ✅ Error con credenciales inválidas
- ✅ Logout
- ✅ Protección de rutas sin autenticación
- ✅ Redirección cuando ya está autenticado

### 2. `pdf-workflow.spec.ts` (7 tests)
Tests del flujo de trabajo con PDFs:
- ✅ Upload de PDF
- ✅ Progreso de upload
- ✅ Visualización de PDF
- ✅ Toolbar del editor
- ✅ Navegación entre vistas
- ✅ Toolbar de campos
- ✅ Panel de guardado

### 3. `form-management.spec.ts` (9 tests)
Tests de gestión de formularios:
- ✅ Estado vacío al iniciar
- ✅ Funcionalidad de upload
- ✅ Información de usuario en header
- ✅ Título de página correcto
- ✅ Persistencia de sesión
- ✅ Diseño responsive
- ✅ Redirecciones de routing
- ✅ Navegación entre páginas

### 4. `error-handling.spec.ts` (13 tests)
Tests de manejo de errores y UX:
- ✅ Errores de validación
- ✅ Validación de formato de email
- ✅ Validación de contraseñas
- ✅ Errores de credenciales inválidas
- ✅ Errores de red
- ✅ Estados de carga
- ✅ Navegación con teclado
- ✅ Toggle de mostrar/ocultar contraseña
- ✅ Branding consistente
- ✅ Accesibilidad de formularios

### 5. `example.spec.ts` (1 test)
Test de ejemplo inicial de Playwright.

## 🚀 Ejecutar Tests

### Prerrequisitos
1. Backend debe estar corriendo en `http://localhost:3000`
2. Frontend debe estar corriendo en `http://localhost:5173`
3. Base de datos PostgreSQL debe estar disponible

### Comandos

```bash
# Ejecutar todos los tests E2E
npm run test:e2e

# Ejecutar con interfaz visual (recomendado para desarrollo)
npm run test:e2e:ui

# Ejecutar con navegador visible
npm run test:e2e:headed

# Ejecutar en modo debug
npm run test:e2e:debug

# Ejecutar un archivo específico
npx playwright test e2e/auth-flow.spec.ts

# Ejecutar un test específico
npx playwright test -g "should register a new user"
```

## 📊 Cobertura de Tests

Total: **36 tests E2E**

### Por Categoría:
- Autenticación: 6 tests (17%)
- PDF Workflow: 7 tests (19%)
- Gestión de Formularios: 9 tests (25%)
- Error Handling & UX: 13 tests (36%)
- Ejemplo: 1 test (3%)

### Áreas Cubiertas:
- ✅ Registro e inicio de sesión
- ✅ Protección de rutas
- ✅ Upload de archivos
- ✅ Navegación y routing
- ✅ Validación de formularios
- ✅ Manejo de errores
- ✅ Estados de carga
- ✅ Accesibilidad básica
- ✅ Responsive design
- ✅ Persistencia de sesión

## 🔧 Configuración

La configuración de Playwright está en [`playwright.config.ts`](../playwright.config.ts):

```typescript
{
  testDir: './e2e',
  baseURL: 'http://localhost:5173',
  webServer: {
    command: 'npm run dev --prefix frontend',
    url: 'http://localhost:5173',
  }
}
```

## 📝 Escribir Nuevos Tests

### Template Básico

```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  const testEmail = `test-${Date.now()}@example.com`;

  test.beforeEach(async ({ page }) => {
    // Setup: Login, navigate, etc.
  });

  test('should do something', async ({ page }) => {
    // Arrange
    await page.goto('/some-page');

    // Act
    await page.click('button');

    // Assert
    await expect(page.locator('text=Success')).toBeVisible();
  });
});
```

### Mejores Prácticas

1. **Usar selectores semánticos**
   ```typescript
   // ✅ Bueno
   page.locator('button:has-text("Submit")')
   page.locator('input[type="email"]')

   // ❌ Evitar
   page.locator('.class-name-12345')
   ```

2. **Emails únicos para cada test**
   ```typescript
   const testEmail = `test-${Date.now()}@example.com`;
   ```

3. **Usar beforeEach para setup común**
   ```typescript
   test.beforeEach(async ({ page }) => {
     // Login compartido
   });
   ```

4. **Verificar estados de carga**
   ```typescript
   await expect(button).toBeDisabled();
   await expect(spinner).toBeVisible();
   ```

5. **Timeouts apropiados**
   ```typescript
   await expect(element).toBeVisible({ timeout: 5000 });
   ```

## 🐛 Debugging

### Ver tests en UI Mode
```bash
npm run test:e2e:ui
```
Esto abre una interfaz visual donde puedes:
- Ver todos los tests
- Ejecutar tests individuales
- Ver screenshots y videos
- Inspeccionar el DOM

### Debug Mode
```bash
npm run test:e2e:debug
```
Abre el Inspector de Playwright para debug paso a paso.

### Screenshots on Failure
Playwright automáticamente captura screenshots cuando un test falla.
Se guardan en `test-results/`.

### Trace Viewer
```bash
npx playwright show-trace trace.zip
```

## ⚡ Performance

### Ejecutar en Paralelo
Por defecto, Playwright ejecuta tests en paralelo:
```typescript
// playwright.config.ts
{
  fullyParallel: true,
  workers: process.env.CI ? 1 : undefined
}
```

### Retryer Failed Tests
En CI, los tests se reintentan automáticamente:
```typescript
{
  retries: process.env.CI ? 2 : 0
}
```

## 📈 CI/CD

Para ejecutar en CI:

```yaml
# .github/workflows/e2e.yml
- name: Install dependencies
  run: npm ci

- name: Install Playwright
  run: npx playwright install --with-deps

- name: Run E2E tests
  run: npm run test:e2e
```

## 🔍 Tests Pendientes (Sprint 3)

Próximos tests a agregar:
- [ ] Flujo de formulario público (`/form/:shareId`)
- [ ] Submit de respuestas
- [ ] Validación de campos en vista pública
- [ ] Compartir formulario
- [ ] Copy to clipboard del link

## 📚 Recursos

- [Playwright Docs](https://playwright.dev)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Playwright Selectors](https://playwright.dev/docs/selectors)
- [Playwright Assertions](https://playwright.dev/docs/test-assertions)

---

**Última actualización:** 2026-01-29
**Total de tests:** 36
**Cobertura:** Sprint 2 completo (Autenticación + Dashboard + Routing)
