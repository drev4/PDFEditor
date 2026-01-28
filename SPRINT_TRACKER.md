# 📅 Sprint Tracker - VuePDF Forms Platform

## 🎯 Sprint Actual: PRE-SPRINT 0 (Preparación)

**Fecha inicio:** 2024-12-27
**Fecha fin:** TBD
**Objetivo:** Preparar ambiente y tomar decisiones técnicas clave

---

## 📋 TAREAS DE ESTA SEMANA

### Lunes 2024-12-27

#### 🔴 CRÍTICO - Hacer HOY
- [ ] **Decisión: Backend Stack** (2 horas)
  - Evaluar Supabase vs Custom Backend
  - Documentar pros/contras
  - Tomar decisión final
  - Razón: Desbloquea todo el desarrollo backend

- [ ] **POC: Campos PDF con pdf-lib** (4 horas)
  - Crear campo text básico
  - Renderizar en PDF
  - Validar que funciona en Adobe Reader
  - Razón: Validar viabilidad técnica

#### 🟡 IMPORTANTE - Hacer si hay tiempo
- [ ] **Diseñar schema de base de datos** (2 horas)
  - Tablas: users, forms, responses
  - Relaciones y constraints
  - Migrations iniciales

- [ ] **Setup proyecto backend** (2 horas)
  - Crear repo o usar Supabase
  - Configurar ambiente local
  - Hello world funcional

#### 🟢 OPCIONAL
- [ ] Revisar competencia (Typeform, JotForm)
- [ ] Bocetos UI del editor de campos

---

### Martes

#### 🔴 CRÍTICO
- [ ] **Implementar Text Field completo** (6 horas)
  - Editor visual (click para agregar)
  - Propiedades (nombre, label, required)
  - Guardar en store
  - Serializar con pdf-lib

#### 🟡 IMPORTANTE
- [ ] **Auth endpoints (si backend custom)** (4 horas)
  - POST /auth/register
  - POST /auth/login
  - GET /auth/me
  - Tests básicos

---

### Miércoles

#### 🔴 CRÍTICO
- [ ] **Implementar Checkbox + Radio** (6 horas)
  - Mismo flujo que text field
  - Grupos de radio buttons
  - Persistencia

#### 🟡 IMPORTANTE
- [ ] **Forms CRUD endpoints** (4 horas)
  - POST /forms (create)
  - GET /forms (list)
  - GET /forms/:id
  - PUT /forms/:id

---

### Jueves

#### 🔴 CRÍTICO
- [ ] **Implementar Dropdown** (4 horas)
  - Configurar opciones
  - Renderizar select

- [ ] **Panel de propiedades de campos** (4 horas)
  - Sidebar con props del campo seleccionado
  - Editar nombre, label, required
  - Eliminar campo

---

### Viernes

#### 🔴 CRÍTICO
- [ ] **Guardar formulario en backend** (6 horas)
  - Serializar campos a JSON
  - POST a /forms
  - Guardar PDF en storage
  - Obtener share_id

#### 🟡 IMPORTANTE
- [ ] **Retro de la semana** (30 min)
  - ¿Qué se completó?
  - ¿Qué bloqueadores hubo?
  - ¿Plan para próxima semana?

---

## 📊 PROGRESO SEMANAL

### Objetivo de la Semana
```
✓ Decisión de backend tomada
✓ POC de campos PDF funcional
✓ Editor básico de campos implementado
✓ API básica funcionando (o Supabase setup)
✓ Guardar formulario funciona
```

### Métricas
- [ ] 4/5 tipos de campos implementados (80%)
- [ ] Backend API desplegada (o Supabase funcionando)
- [ ] 1 formulario guardado exitosamente end-to-end

---

## 🚧 BLOQUEADORES ACTUALES

| Bloqueador | Impacto | Owner | ETA Resolución |
|------------|---------|-------|----------------|
| - | - | - | - |

---

## 💡 DECISIONES DE LA SEMANA

### Decisión #1: Backend Stack
**Fecha:** 2024-12-27
**Opciones:**
1. **Supabase**
   - Pros: Rápido, auth incluido, PostgreSQL, storage
   - Contras: Vendor lock-in, menos control
   - Tiempo: 1 día setup

2. **Custom Backend (Express + PostgreSQL)** ✅
   - Pros: Control total, portable, mejor para aprender
   - Contras: Más trabajo inicial (3-4 días)
   - Tiempo: 1 semana setup completo

**Decisión tomada:** Custom Backend (Express + PostgreSQL + Prisma)
**Razón:** Proyecto de aprendizaje - queremos entender todo el stack y tener control total
**Hosting:** Railway (gratis) → Azure (producción con tráfico)
**ORM:** Prisma (facilita migración entre plataformas)

---

### Decisión #2: Arquitectura de Campos
**Fecha:** TBD
**Opciones:**
1. **PDF.js annotations + pdf-lib**
   - Renderizar campos como annotations
   - Editar con pdf-lib

2. **HTML overlay + pdf-lib al exportar**
   - Campos HTML sobre PDF
   - Serializar a pdf-lib solo al guardar

**Decisión tomada:** [PENDIENTE]
**Razón:** -

---

## 📝 NOTAS DIARIAS

### 2024-12-27 (Lunes)
**Hecho:**
- ✅ Análisis completo de producto actualizado
- ✅ Roadmap creado
- ✅ Prioridades redefinidas
- ✅ Suite de tests completada (fase anterior)

**Aprendizajes:**
- Visión del producto es plataforma de formularios, no editor genérico
- Prioridades cambian completamente con la nueva visión
- Backend es crítico desde el inicio

**Próximo paso:**
- Decidir backend stack mañana
- POC de campos PDF

**Bloqueadores:**
- Ninguno

---

### 2024-12-28 (Martes)
**Hecho:**
- [ ]

**Aprendizajes:**
-

**Próximo paso:**
-

**Bloqueadores:**
-

---

## 🎯 BACKLOG PRIORIZADO (Próximas semanas)

### Sprint 1: Backend + Campos Básicos (Semana 1-2)
```
Objetivo: Editor de campos + API funcional

□ Campos de formulario (text, checkbox, radio, dropdown)
□ Editor visual de campos
□ Backend API (auth, forms, responses)
□ Guardar formulario en DB
□ Generar share_id
```

### Sprint 2: Visualizador Público (Semana 3-4)
```
Objetivo: URLs compartibles funcionales

□ Ruta pública /form/:shareId
□ Renderizar formulario con campos
□ Campos interactivos (rellenar)
□ Submit respuestas
□ Página de confirmación
```

### Sprint 3: Dashboard (Semana 5-6)
```
Objetivo: Ver y gestionar respuestas

□ Lista de formularios
□ Vista de respuestas
□ Exportar CSV/Excel
□ Búsqueda y filtros
□ Analytics básicos
```

---

## 📊 VELOCITY Y ESTIMACIONES

### Capacidad Semanal
- **Horas disponibles:** ~40 horas/semana
- **Horas productivas:** ~30 horas/semana (asumiendo interrupciones)

### Velocity Estimado
- **Semana 1:** N/A (primera semana)
- **Semana 2:** TBD
- **Semana 3:** TBD

### Burndown
```
Semana 1:  [░░░░░░░░░░] 0%
Semana 2:  [░░░░░░░░░░] 0%
Semana 3:  [░░░░░░░░░░] 0%
```

---

## 🔬 EXPERIMENTOS Y POCS

### POC #1: Campos PDF con pdf-lib
**Fecha:** 2024-12-27
**Objetivo:** Validar que podemos crear campos interactivos
**Hipótesis:** pdf-lib permite crear campos que funcionan en Adobe Reader
**Criterio de éxito:** Campo text funcional en Adobe Reader
**Status:** ✅ COMPLETADO
**Resultado:** Todos los tipos de campos funcionan correctamente:
- TextField (simple y multilinea)
- CheckBox
- RadioGroup
- Dropdown

### POC #2: Supabase Setup
**Fecha:** TBD
**Objetivo:** Evaluar si Supabase es viable
**Hipótesis:** Supabase reduce 80% del trabajo de backend
**Criterio de éxito:** Auth + CRUD funcional en <1 día
**Status:** ❌ TODO
**Resultado:** -

---

## 📚 RECURSOS Y REFERENCIAS

### Docs a revisar esta semana
- [ ] [pdf-lib Form Fields](https://pdf-lib.js.org/docs/api/classes/pdfform)
- [ ] [Supabase Auth](https://supabase.com/docs/guides/auth)
- [ ] [PostgreSQL Schema Design](https://www.postgresql.org/docs/current/ddl.html)

### Ejemplos/Inspiración
- [ ] Typeform - UX de formularios
- [ ] JotForm - Editor de campos
- [ ] Google Forms - Simplicidad

---

## 🐛 BUGS Y ISSUES

| ID | Descripción | Prioridad | Status | Asignado |
|----|-------------|-----------|--------|----------|
| - | - | - | - | - |

---

## 💭 IDEAS Y NOTAS RÁPIDAS

### Ideas para futuro
- Integración con Zapier/Make
- Templates de formularios (contacto, encuesta, registro)
- Modo colaborativo (varios editores)
- Versioning de formularios
- A/B testing de formularios

### Preguntas sin resolver
- ¿Límite de respuestas por formulario en free tier?
- ¿Permitir formularios anónimos sin login?
- ¿Guardar respuestas incompletas (draft)?
- ¿GDPR compliance desde el inicio?

---

## ✅ CHECKLIST SEMANAL

### Inicio de Semana (Lunes)
- [ ] Revisar objetivos de la semana
- [ ] Priorizar tareas
- [ ] Identificar bloqueadores potenciales
- [ ] Actualizar este documento

### Durante la Semana
- [ ] Actualizar progreso diario
- [ ] Documentar decisiones
- [ ] Marcar tareas completadas
- [ ] Reportar bloqueadores

### Fin de Semana (Viernes)
- [ ] Retro de la semana
- [ ] Actualizar roadmap si es necesario
- [ ] Planear próxima semana
- [ ] Celebrar wins 🎉

---

## 📈 MÉTRICAS DE SPRINT

### Sprint 0 (Actual)
- **Story points completados:** 0/TBD
- **Tasks completadas:** 0/TBD
- **Bloqueadores:** 0
- **Scope creep:** No

---

**Última actualización:** 2024-12-27
**Próxima revisión:** 2024-12-28

---

## 🎯 RESUMEN EJECUTIVO

### Esta Semana
**Objetivo:** Validar viabilidad técnica y setup inicial
**Prioridad #1:** POC de campos PDF
**Prioridad #2:** Decidir backend stack
**Prioridad #3:** Implementar campos básicos

### Próxima Semana
**Objetivo:** TBD
**Prioridad #1:** TBD

### Este Mes
**Objetivo:** Backend + Editor funcional
**Meta:** Poder crear y guardar formularios

---

**Nota:** Actualizar este documento DIARIAMENTE con progreso y aprendizajes.
