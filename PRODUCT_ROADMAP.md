# 🚀 VuePDF Forms Platform - Roadmap & Tracking

## 📌 Visión del Producto

**VuePDF Forms** es una plataforma SaaS para crear, compartir y gestionar formularios PDF interactivos.

### Flujo del Usuario
1. **Creador** crea formulario PDF con campos personalizados
2. **Creador** genera URL compartible única
3. **Respondedores** rellenan formulario vía URL (sin cuenta)
4. **Plataforma** almacena respuestas
5. **Creador** ve y analiza respuestas en dashboard

---

## 🎯 ESTADO ACTUAL

**Fecha de inicio:** 2024-01-01
**Última actualización:** 2024-12-27
**Versión actual:** 0.1.0 (Pre-MVP)

### Features Completadas ✅
- [x] Editor básico de PDFs
- [x] Visualización de PDFs
- [x] Navegación entre páginas
- [x] Zoom y rotación
- [x] Agregar texto e imágenes
- [x] Suite de tests (132 tests, 94% coverage en stores)
- [x] Thumbnails con drag & drop
- [x] Múltiples documentos
- [x] Búsqueda de texto
- [x] Grid con snap-to-grid

### Features en Progreso 🚧
- [ ] Ninguna actualmente

### Próximos Pasos 🎯
- [ ] Campos de formulario PDF
- [ ] Backend API
- [ ] Autenticación

---

## 📊 PROGRESO GENERAL

```
Fase 0: MVP Core          [▓░░░░░░░░░]  10%  (1/8 completado)
Fase 1: Features Esencial [░░░░░░░░░░]   0%  (0/8 completado)
Fase 2: Mejoras           [░░░░░░░░░░]   0%  (0/8 completado)
Fase 3: Editor Avanzado   [▓▓░░░░░░░░]  25%  (1/4 completado - tests)

TOTAL PRODUCTO            [▓░░░░░░░░░]  12%
```

---

## 🔴 FASE 0: MVP CORE (Crítico - Sin esto NO hay producto)

**Objetivo:** Flujo completo funcional de punta a punta
**Duración estimada:** 8-10 semanas
**Estado:** 🚧 EN PROGRESO

| # | Feature | Prioridad | Esfuerzo | Status | Asignado | Notas |
|---|---------|-----------|----------|--------|----------|-------|
| 1 | Campos de formulario PDF | 🔴 CRÍTICA | 3-5 días | ❌ TODO | - | Text, Checkbox, Radio, Dropdown |
| 2 | Backend API básico | 🔴 CRÍTICA | 3-4 días | ❌ TODO | - | Auth, Forms, Responses endpoints |
| 3 | Autenticación usuarios | 🔴 CRÍTICA | 2-3 días | ❌ TODO | - | JWT, Register, Login |
| 4 | Guardar formularios en DB | 🔴 CRÍTICA | 1-2 días | ❌ TODO | - | PostgreSQL schema |
| 5 | Generación URLs compartibles | 🔴 CRÍTICA | 1 día | ❌ TODO | - | share_id único |
| 6 | Visualizador público | 🔴 CRÍTICA | 3-4 días | ❌ TODO | - | Ruta pública + campos interactivos |
| 7 | Envío de respuestas | 🔴 CRÍTICA | 2 días | ❌ TODO | - | POST responses + validación |
| 8 | Dashboard de respuestas | 🔴 CRÍTICA | 2-3 días | ❌ TODO | - | Lista, filtros, exportar |

### Detalles de Features

#### Feature #1: Campos de Formulario PDF
**Objetivo:** Permitir agregar campos interactivos al PDF

**Tasks:**
- [ ] Implementar Text Input con pdf-lib
- [ ] Implementar Checkbox
- [ ] Implementar Radio Buttons
- [ ] Implementar Dropdown
- [ ] Editor visual (click para agregar campo)
- [ ] Drag & resize de campos
- [ ] Panel de propiedades
- [ ] Guardar campos en JSON
- [ ] Serializar con pdf-lib
- [ ] Tests unitarios

**Acceptance Criteria:**
- Se pueden agregar 4 tipos de campos
- Campos son editables (posición, tamaño, propiedades)
- Campos se guardan en el PDF
- Campos funcionan en Adobe Reader

**Bloqueadores:** Ninguno
**Dependencias:** pdf-lib (ya instalado)

---

#### Feature #2: Backend API Básico
**Objetivo:** API REST para usuarios, formularios y respuestas

**Tasks:**
- [ ] Decisión: Express/FastAPI/Supabase
- [ ] Setup proyecto backend
- [ ] Configurar PostgreSQL
- [ ] Modelos de datos (Prisma/SQLAlchemy)
- [ ] Migrations
- [ ] Auth endpoints (register, login, me)
- [ ] Forms CRUD endpoints
- [ ] Responses endpoints
- [ ] Public endpoint (get form by shareId)
- [ ] Validación de datos (Zod/Joi)
- [ ] Rate limiting
- [ ] CORS config
- [ ] Tests de integración
- [ ] Documentación API (Swagger)

**Stack Recomendado:**
```
Opción 1 (Rápida): Supabase
- Pros: Auth + DB + Storage todo-en-uno
- Contras: Vendor lock-in

Opción 2 (Control): Express + PostgreSQL
- Pros: Control total
- Contras: Más setup inicial

Decisión: TBD
```

**Bloqueadores:** Ninguno
**Dependencias:** Hosting (Railway/Fly.io/Vercel)

---

#### Feature #6: Visualizador Público
**Objetivo:** Página pública donde respondedores rellenan formulario

**Tasks:**
- [ ] Ruta /form/:shareId
- [ ] Fetch form desde API
- [ ] Renderizar PDF con PDF.js
- [ ] Superponer campos HTML sobre PDF
- [ ] Hacer campos interactivos
- [ ] Validación client-side
- [ ] Submit form handler
- [ ] POST a /api/forms/:id/responses
- [ ] Página de confirmación
- [ ] Estados: loading, closed, error, success
- [ ] Mobile responsive
- [ ] Tests E2E

**Acceptance Criteria:**
- URL funciona sin login
- Formulario se renderiza
- Campos son rellenables
- Validación funciona
- Envío guarda en DB
- Funciona en mobile

**Bloqueadores:** Feature #1, #2
**Dependencias:** Backend API, Campos PDF

---

#### Feature #8: Dashboard de Respuestas
**Objetivo:** Panel para ver y gestionar respuestas

**Tasks:**
- [ ] Ruta /dashboard/forms
- [ ] Lista de formularios con stats
- [ ] Vista de respuestas (tabla)
- [ ] Detalle de respuesta individual
- [ ] Búsqueda y filtros
- [ ] Ordenar columnas
- [ ] Exportar a CSV
- [ ] Exportar a Excel
- [ ] Analytics básicos (gráficos)
- [ ] Eliminar respuestas
- [ ] Paginación
- [ ] Tests

**Acceptance Criteria:**
- Lista de forms se muestra
- Stats son precisos
- Tabla de respuestas funciona
- Exportar CSV/Excel funciona
- Búsqueda funciona
- Mobile responsive

**Bloqueadores:** Feature #2, #7
**Dependencias:** Backend API, Responses

---

## 🟡 FASE 1: FEATURES ESENCIALES

**Objetivo:** Hacer el producto usable y profesional
**Duración estimada:** 2-3 semanas
**Estado:** ⏸️ PENDIENTE

| # | Feature | Prioridad | Esfuerzo | Status | Notas |
|---|---------|-----------|----------|--------|-------|
| 9 | Validaciones de campos | 🟡 ALTA | 2 días | ❌ TODO | Required, email, number |
| 10 | Tipos de campos avanzados | 🟡 ALTA | 2-3 días | ❌ TODO | Date, email, number, file upload |
| 11 | Notificación email | 🟡 ALTA | 1 día | ❌ TODO | Nueva respuesta → email creador |
| 12 | Exportar CSV/Excel | 🟡 ALTA | 1 día | ❌ TODO | Con todas las respuestas |
| 13 | Editar formulario publicado | 🟡 ALTA | 2 días | ❌ TODO | Sin romper URL |
| 14 | Duplicar formulario | 🟡 MEDIA | 4 horas | ❌ TODO | Template/reutilizar |
| 15 | Preview antes de publicar | 🟡 ALTA | 1 día | ❌ TODO | Ver cómo se verá |
| 16 | Página confirmación custom | 🟡 MEDIA | 4 horas | ❌ TODO | "Gracias" personalizado |

---

## 🟢 FASE 2: MEJORAS Y DIFERENCIADORES

**Objetivo:** Features que hacen la plataforma competitiva
**Duración estimada:** 2-3 semanas
**Estado:** ⏸️ PENDIENTE

| # | Feature | Prioridad | Esfuerzo | Status | Notas |
|---|---------|-----------|----------|--------|-------|
| 17 | Analytics de respuestas | 🟢 MEDIA | 2-3 días | ❌ TODO | Gráficos, stats avanzados |
| 18 | Lógica condicional | 🟢 BAJA | 3-5 días | ❌ TODO | Mostrar campo si X=Y |
| 19 | Límite de respuestas | 🟢 MEDIA | 1 día | ❌ TODO | Max N respuestas |
| 20 | Cerrar formulario (deadline) | 🟢 MEDIA | 4 horas | ❌ TODO | Fecha límite |
| 21 | Mensaje personalizado | 🟢 BAJA | 4 horas | ❌ TODO | Custom confirmación |
| 22 | Webhooks | 🟢 BAJA | 2 días | ❌ TODO | Integrar Zapier, Make |
| 23 | Formulario con contraseña | 🟢 BAJA | 1 día | ❌ TODO | Acceso restringido |
| 24 | Temas/branding | 🟢 MEDIA | 2 días | ❌ TODO | Logo, colores |

---

## 🎨 FASE 3: EDITOR AVANZADO (Secundario)

**Objetivo:** Mejorar experiencia del editor
**Duración estimada:** 1-2 semanas
**Estado:** 🚧 PARCIAL (tests completados)

| # | Feature | Prioridad | Esfuerzo | Status | Notas |
|---|---------|-----------|----------|--------|-------|
| 25 | Atajos de teclado | 🟢 BAJA | 6 horas | ❌ TODO | Ctrl+Z, etc. |
| 26 | Dibujo libre | 🟢 BAJA | 2 días | ❌ TODO | Anotar PDFs |
| 27 | Resaltador de texto | 🟢 BAJA | 1 día | ❌ TODO | Highlight texto |
| 28 | Drag & Drop para abrir | 🟡 MEDIA | 2 horas | ❌ TODO | UX mejorada |
| - | Suite de tests | 🟢 MEDIA | - | ✅ DONE | 132 tests, 94% coverage |

---

## 📅 SPRINTS PLANIFICADOS

### Sprint 1: Backend Foundation (2 semanas)
**Fecha:** TBD
**Objetivo:** API funcional con autenticación

**Features incluidas:**
- Feature #2: Backend API básico
- Feature #3: Autenticación
- Feature #4: Guardar formularios en DB

**Entregable:** API documentada y desplegada

---

### Sprint 2: Editor de Formularios (2 semanas)
**Fecha:** TBD
**Objetivo:** Crear formularios con campos

**Features incluidas:**
- Feature #1: Campos de formulario PDF
- Feature #5: Generación URLs compartibles

**Entregable:** Editor funcional, formularios guardables

---

### Sprint 3: Visualizador Público (2 semanas)
**Fecha:** TBD
**Objetivo:** URLs compartibles funcionales

**Features incluidas:**
- Feature #6: Visualizador público
- Feature #7: Envío de respuestas
- Feature #16: Página confirmación

**Entregable:** URL compartible funcionando end-to-end

---

### Sprint 4: Dashboard (2 semanas)
**Fecha:** TBD
**Objetivo:** Ver y gestionar respuestas

**Features incluidas:**
- Feature #8: Dashboard de respuestas
- Feature #12: Exportar CSV/Excel
- Feature #11: Notificaciones email

**Entregable:** Dashboard completo

---

### Sprint 5: Polish & Launch (2 semanas)
**Fecha:** TBD
**Objetivo:** MVP lanzable

**Features incluidas:**
- Feature #9: Validaciones avanzadas
- Feature #10: Campos avanzados
- Feature #15: Preview
- Bug fixes
- Tests E2E
- Documentation
- Deploy producción

**Entregable:** 🚀 MVP EN PRODUCCIÓN

---

## 🎯 HITOS (Milestones)

| Hito | Fecha Target | Status | Descripción |
|------|--------------|--------|-------------|
| M0: Backend funcional | TBD | ❌ | API con auth desplegada |
| M1: Editor funcional | TBD | ❌ | Crear formularios con campos |
| M2: URL compartible | TBD | ❌ | Visualizador público funciona |
| M3: Dashboard básico | TBD | ❌ | Ver y exportar respuestas |
| M4: MVP Launch | TBD | ❌ | Producto en producción |
| M5: Beta privada | TBD | ❌ | 10 usuarios beta |
| M6: Beta pública | TBD | ❌ | 100 usuarios |
| M7: Launch público | TBD | ❌ | Marketing + lanzamiento |

---

## 🚧 BLOQUEADORES Y RIESGOS

### Bloqueadores Actuales
- [ ] Ninguno actualmente

### Riesgos Identificados

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Complejidad de pdf-lib campos | Media | Alto | POC primero, validar viabilidad |
| Escalabilidad backend | Baja | Medio | Usar servicios managed (Supabase) |
| Compatibilidad PDFs | Alta | Alto | Testear con múltiples readers |
| Performance con PDFs grandes | Media | Medio | Límite de tamaño, lazy loading |
| Costos de storage | Baja | Bajo | Usar R2/S3 (barato) |

---

## 📊 MÉTRICAS DE ÉXITO

### Fase MVP (M4)
- [ ] 100% features Fase 0 completadas
- [ ] 0 bugs críticos
- [ ] <2s tiempo de carga
- [ ] 95%+ uptime
- [ ] Tests coverage >80%

### Beta Privada (M5)
- [ ] 10 usuarios beta activos
- [ ] 50+ formularios creados
- [ ] 200+ respuestas recibidas
- [ ] NPS >40

### Beta Pública (M6)
- [ ] 100 usuarios activos
- [ ] 500+ formularios creados
- [ ] 2000+ respuestas
- [ ] <5% churn
- [ ] NPS >50

### Launch Público (M7)
- [ ] 1000+ usuarios registrados
- [ ] 100+ usuarios pagando
- [ ] $1000+ MRR
- [ ] NPS >60

---

## 🔧 STACK TECNOLÓGICO

### Frontend (Actual)
- Vue 3 + TypeScript
- Vite
- Pinia (state)
- PrimeVue (UI)
- Tailwind CSS
- PDF.js (rendering)
- pdf-lib (editing)
- Vitest (testing)

### Backend (Por decidir)
```
Opción A: Supabase (Recomendada para MVP rápido)
- PostgreSQL
- Auth built-in
- Storage built-in
- Realtime subscriptions
- Auto-generated REST API

Opción B: Custom (Node.js)
- Express/Fastify
- PostgreSQL (Neon/Supabase)
- Prisma ORM
- JWT auth
- Cloudflare R2 (storage)

Decisión: TBD (Semana 1)
```

### Infraestructura
- Frontend: Vercel/Netlify
- Backend: Railway/Fly.io (si custom)
- Database: Supabase/Neon (PostgreSQL)
- Storage: Cloudflare R2 / S3
- Email: Resend/SendGrid
- Analytics: PostHog/Plausible
- Error tracking: Sentry

---

## 📝 DECISIONES CLAVE

### Decisión #1: Backend Stack
**Fecha:** Pendiente
**Opciones:** Supabase vs Custom Backend
**Recomendación:** Supabase para MVP, migrar después si es necesario
**Razón:** Time-to-market, menos código, auth incluido
**Status:** ⏸️ PENDIENTE

### Decisión #2: Pricing Model
**Fecha:** Pendiente
**Opciones:**
- Freemium (3 forms free, unlimited paid)
- Per-response ($0.10/response)
- Flat monthly ($9, $29, $99)
**Status:** ⏸️ PENDIENTE

### Decisión #3: Multi-tenancy
**Fecha:** Pendiente
**Opciones:**
- Single DB (row-level security)
- DB per tenant
**Recomendación:** Single DB con RLS
**Status:** ⏸️ PENDIENTE

---

## 🎯 PRÓXIMOS PASOS INMEDIATOS

### Esta Semana
1. [ ] Decidir stack backend (Supabase vs Custom)
2. [ ] Setup proyecto backend
3. [ ] Diseñar schema de base de datos
4. [ ] POC: Crear campo text con pdf-lib
5. [ ] Documentar arquitectura completa

### Próximas 2 Semanas
1. [ ] Implementar auth completo
2. [ ] Implementar Forms CRUD
3. [ ] Implementar campos básicos en editor
4. [ ] Primera versión de editor funcional

### Este Mes
1. [ ] Backend API completo
2. [ ] Editor de formularios funcional
3. [ ] Primera versión visualizador público
4. [ ] Tests de integración

---

## 📚 RECURSOS Y DOCUMENTACIÓN

### Docs Técnicas
- [PDF.js Documentation](https://mozilla.github.io/pdf.js/)
- [pdf-lib Documentation](https://pdf-lib.js.org/)
- [Supabase Docs](https://supabase.com/docs)
- [Vue 3 Docs](https://vuejs.org/)

### Referencias de Competencia
- Typeform (UX inspiration)
- JotForm (features)
- Google Forms (simplicidad)
- Fillout.com (forms platform)
- Tally.so (form builder)

### Docs Internas
- [TESTING.md](./TESTING.md) - Testing guide
- [README.md](./README.md) - General overview

---

## 📞 CONTACTO Y EQUIPO

**Product Lead:** @drev4
**Developer:** @drev4
**Última actualización:** 2025-12-27

---

## 📊 CHANGELOG

### 2025-12-27
- Creado roadmap inicial
- Definidas Fases 0-3
- Identificadas 28 features
- Planificados 5 sprints
- Definidos 7 hitos

---

**Nota:** Este documento es un living document y se actualizará semanalmente.
