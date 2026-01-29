# 📄 VuePDF Forms Platform

Plataforma completa para crear, editar y compartir formularios PDF interactivos con backend robusto y autenticación.

## ✨ Características Principales

### 🔐 Autenticación y Usuarios
- Registro e inicio de sesión con JWT
- Protección de rutas con guards de navegación
- Gestión de sesiones persistentes
- Dashboard personalizado por usuario

### 📝 Editor de Formularios PDF
- Visualización de PDFs con navegación avanzada
- 5 tipos de campos interactivos:
  - Text (texto simple)
  - Textarea (texto multilínea)
  - Checkbox
  - Radio buttons
  - Dropdown/Select
- Drag & drop para posicionar campos
- Sistema de miniaturas con reordenamiento de páginas
- Herramientas de edición (texto, imágenes, búsqueda)
- Sistema de undo/redo (snapshots)

### 💾 Persistencia y Backend
- Upload de PDFs con progress tracking
- Guardar y cargar formularios desde base de datos
- Operaciones bulk para campos
- Sincronización automática
- Sistema de shareId para compartir

### 🎨 UI/UX Moderna
- Diseño profesional con PrimeVue + Tailwind
- Loading states y feedback visual
- Manejo robusto de errores
- Responsive design
- Animaciones fluidas

## 🏗️ Stack Tecnológico

### Frontend
- **Vue 3** - Framework progresivo con Composition API
- **TypeScript** - Type safety end-to-end
- **Vite** - Build tool ultra rápido
- **Pinia** - State management
- **Vue Router** - Routing con guards
- **PrimeVue** - Componentes UI modernos
- **Tailwind CSS** - Utility-first CSS
- **PDF.js** - Renderizado de PDFs
- **pdf-lib** - Manipulación de PDFs
- **Axios** - Cliente HTTP con interceptors

### Backend
- **Node.js** + **Express** - API REST
- **TypeScript** - Type safety
- **Prisma** - ORM moderno
- **PostgreSQL** - Base de datos
- **JWT** - Autenticación
- **bcrypt** - Hash de contraseñas
- **Zod** - Validación de schemas
- **Multer** - Upload de archivos
- **nanoid** - Generación de IDs únicos

### Testing
- **Vitest** - Tests unitarios y de integración
- **@testing-library/vue** - Tests de componentes
- **Playwright** - Tests E2E (36 tests)

### DevOps
- **Docker** - Contenedorización
- **docker-compose** - Orquestación local
- **Railway/Azure** - Deployment (planeado)

## 🚀 Instalación y Setup

### Prerrequisitos
- Node.js >= 18.0.0
- PostgreSQL >= 14
- npm >= 9.0.0

### 1. Clonar el repositorio
```bash
git clone <repository-url>
cd VuePDF
```

### 2. Instalar dependencias
```bash
npm install
```

### 3. Configurar Base de Datos

#### Opción A: Usar Docker (Recomendado)
```bash
# Iniciar PostgreSQL con docker-compose
npm run docker:up

# La base de datos estará disponible en:
# Host: localhost
# Port: 5432
# Database: vuepdf
# User: postgres
# Password: postgres
```

#### Opción B: PostgreSQL Local
Asegúrate de tener PostgreSQL corriendo y crea una base de datos:
```sql
CREATE DATABASE vuepdf;
```

### 4. Configurar Variables de Entorno

#### Backend (.env en /backend)
```env
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/vuepdf?schema=public"

# JWT
JWT_SECRET="your-super-secret-jwt-key-change-in-production"

# Server
PORT=3000
NODE_ENV=development

# Upload
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=10485760
```

#### Frontend (.env en /frontend)
```env
VITE_API_URL=http://localhost:3000/api
```

### 5. Generar Prisma Client y Migrar DB
```bash
# Generar cliente de Prisma
npm run db:generate

# Ejecutar migraciones
npm run db:migrate

# (Opcional) Abrir Prisma Studio para explorar la DB
npm run db:studio
```

### 6. Iniciar el Proyecto
```bash
# Iniciar backend + frontend simultáneamente
npm run dev

# O iniciar por separado:
npm run dev:backend  # Backend en http://localhost:3000
npm run dev:frontend # Frontend en http://localhost:5173
```

## 🧪 Testing

### Tests Unitarios y de Integración

```bash
# Ejecutar tests del frontend
npm run test:frontend

# Ejecutar tests del backend
npm run test:backend

# Ejecutar todos los tests unitarios
npm test
```

### Tests E2E con Playwright

```bash
# Ejecutar tests E2E (requiere app corriendo)
npm run test:e2e

# Ejecutar con UI visual (recomendado)
npm run test:e2e:ui

# Ejecutar con navegador visible
npm run test:e2e:headed

# Ejecutar en modo debug
npm run test:e2e:debug

# Ejecutar TODOS los tests (unit + integration + E2E)
npm run test:all
```

**Nota:** Para tests E2E, asegúrate de que:
1. La base de datos esté corriendo
2. El backend esté corriendo (`npm run dev:backend`)
3. El frontend esté corriendo (`npm run dev:frontend`)

Ver [e2e/README.md](e2e/README.md) para más detalles sobre tests E2E.

## 📁 Estructura del Proyecto

```
VuePDF/
├── backend/                    # Backend API
│   ├── src/
│   │   ├── routes/            # Rutas de API
│   │   │   ├── auth.ts        # Autenticación
│   │   │   ├── forms.ts       # CRUD de formularios
│   │   │   └── upload.ts      # Upload de PDFs
│   │   ├── middleware/        # Middleware de Express
│   │   │   ├── auth.ts        # Autenticación JWT
│   │   │   ├── errorHandler.ts
│   │   │   └── upload.ts      # Multer config
│   │   ├── services/          # Servicios
│   │   │   └── db.ts          # Prisma client
│   │   ├── app.ts             # Express app
│   │   └── index.ts           # Entry point
│   ├── prisma/
│   │   └── schema.prisma      # Schema de base de datos
│   ├── tests/                 # Tests backend
│   └── uploads/               # PDFs subidos
│
├── frontend/                   # Frontend Vue
│   ├── src/
│   │   ├── components/        # Componentes Vue
│   │   │   ├── auth/          # Login/Register
│   │   │   ├── editor/        # Editor de PDF
│   │   │   ├── form-fields/   # Campos de formulario
│   │   │   ├── forms/         # Gestión de forms
│   │   │   ├── pdf/           # Visualizador PDF
│   │   │   ├── toolbars/      # Barras de herramientas
│   │   │   └── ui/            # Componentes UI
│   │   ├── composables/       # Lógica reutilizable
│   │   │   ├── usePDFUpload.ts
│   │   │   ├── useFormManagement.ts
│   │   │   ├── useDragAndDrop.ts
│   │   │   └── ... (13 composables)
│   │   ├── stores/            # Pinia stores
│   │   │   ├── auth.store.ts
│   │   │   ├── forms.store.ts
│   │   │   ├── formFields.store.ts
│   │   │   ├── document.store.ts
│   │   │   ├── editor.store.ts
│   │   │   ├── snapshots.store.ts
│   │   │   └── ... (7 stores)
│   │   ├── services/          # API services
│   │   │   ├── api.ts         # Base API
│   │   │   ├── auth.ts
│   │   │   ├── forms.ts
│   │   │   ├── fields.ts
│   │   │   └── upload.ts
│   │   ├── views/             # Vistas/Páginas
│   │   │   ├── LoginView.vue
│   │   │   ├── RegisterView.vue
│   │   │   └── DashboardView.vue
│   │   ├── router/            # Vue Router
│   │   │   └── index.ts       # Routes + guards
│   │   ├── types/             # TypeScript types
│   │   └── main.ts            # Entry point
│   └── tests/                 # Tests frontend
│
├── e2e/                        # Tests E2E (Playwright)
│   ├── auth-flow.spec.ts      # 6 tests
│   ├── pdf-workflow.spec.ts   # 7 tests
│   ├── form-management.spec.ts # 9 tests
│   ├── error-handling.spec.ts  # 13 tests
│   └── README.md              # Docs de E2E
│
├── docs/                       # Documentación
│   ├── pdf-upload-guide.md
│   └── user-guide-pdf-upload.md
│
├── docker-compose.yml          # PostgreSQL setup
├── playwright.config.ts        # Config de Playwright
├── SPRINT_TRACKER.md          # Seguimiento de sprints
├── NEXT_STEPS.md              # Próximos pasos planificados
├── TECHNICAL_SPECS.md         # Especificaciones técnicas
├── PRODUCT_ROADMAP.md         # Roadmap del producto
└── package.json               # Monorepo config
```

## 🎯 Uso de la Aplicación

### 1. Registro e Inicio de Sesión
1. Accede a `http://localhost:5173`
2. Crea una cuenta en `/register`
3. Inicia sesión en `/login`

### 2. Dashboard
- Vista principal después de login
- Muestra tus formularios (si los tienes)
- Botón para subir nuevo PDF

### 3. Crear Formulario PDF
1. Click en "Upload PDF" o drag & drop
2. Selecciona un archivo PDF
3. Espera a que se suba (verás barra de progreso)
4. PDF se renderiza en el editor

### 4. Agregar Campos
1. Selecciona tipo de campo en toolbar
2. Click en el PDF donde quieres el campo
3. Configura propiedades del campo (nombre, required, etc.)
4. Repite para todos los campos necesarios

### 5. Guardar Formulario
1. Click en botón "Save" o panel de guardado
2. Ingresa título y descripción
3. Formulario se guarda en la base de datos
4. Puedes cargarlo después desde tu lista de formularios

## 🔧 Scripts Disponibles

### Desarrollo
```bash
npm run dev              # Backend + Frontend
npm run dev:frontend     # Solo frontend
npm run dev:backend      # Solo backend
```

### Build
```bash
npm run build            # Build ambos
npm run build:frontend   # Build frontend
npm run build:backend    # Build backend
```

### Testing
```bash
npm test                 # Tests frontend
npm run test:frontend    # Tests frontend
npm run test:backend     # Tests backend
npm run test:e2e         # Tests E2E
npm run test:all         # Todos los tests
```

### Base de Datos
```bash
npm run db:generate      # Generar Prisma client
npm run db:push          # Push schema (dev)
npm run db:migrate       # Crear migración
npm run db:studio        # Abrir Prisma Studio
```

### Docker
```bash
npm run docker:up        # Iniciar PostgreSQL
npm run docker:down      # Detener PostgreSQL
```

### Lint
```bash
npm run lint             # Lint en workspaces
```

## 📊 Estado del Proyecto

### Sprint 2: ✅ 95% Completado

**Completado:**
- ✅ Sistema de autenticación completo
- ✅ Router con guards de navegación
- ✅ Dashboard funcional
- ✅ Upload de PDF con progress tracking
- ✅ Persistencia de formularios y campos
- ✅ Operaciones bulk de campos
- ✅ Suite completa de tests (680+ líneas backend, 1,300+ líneas frontend)
- ✅ 36 tests E2E con Playwright
- ✅ 4 composables reutilizables
- ✅ Sistema de snapshots (undo/redo)
- ✅ Documentación completa

**Pendiente:**
- [ ] Testing de integración final
- [ ] Ajustes finales de UX

### Próximo Sprint (Sprint 3): Visualizador Público
- Ruta pública `/form/:shareId`
- Campos interactivos rellenables
- Submit de respuestas
- Página de confirmación

Ver [SPRINT_TRACKER.md](SPRINT_TRACKER.md) para detalles completos.

## 📈 Métricas de Calidad

- **Tests Unitarios:** 30+ archivos
- **Tests E2E:** 36 tests
- **Cobertura de código:** ~80%
- **Type Safety:** 100% TypeScript
- **Commits:** 16 commits principales
- **Líneas de código:** ~15,000+ líneas

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📝 Documentación Adicional

- [Sprint Tracker](SPRINT_TRACKER.md) - Seguimiento de sprints y progreso
- [Next Steps](NEXT_STEPS.md) - Próximos pasos planificados
- [Technical Specs](TECHNICAL_SPECS.md) - Especificaciones técnicas detalladas
- [Product Roadmap](PRODUCT_ROADMAP.md) - Roadmap del producto
- [E2E Tests](e2e/README.md) - Documentación de tests E2E
- [PDF Upload Guide](docs/pdf-upload-guide.md) - Guía de upload de PDFs
- [User Guide](docs/user-guide-pdf-upload.md) - Guía de usuario

## 🐛 Troubleshooting

### Base de datos no conecta
```bash
# Verificar que PostgreSQL está corriendo
npm run docker:up

# Verificar conexión
psql -h localhost -U postgres -d vuepdf
```

### Error en migraciones de Prisma
```bash
# Resetear base de datos (CUIDADO: borra todos los datos)
npx prisma migrate reset

# Regenerar cliente
npm run db:generate
```

### Tests E2E fallan
```bash
# Verificar que todo está corriendo:
# 1. PostgreSQL (puerto 5432)
# 2. Backend (puerto 3000)
# 3. Frontend (puerto 5173)

# Instalar navegadores de Playwright
npx playwright install --with-deps
```

### Puerto ya en uso
```bash
# Backend (puerto 3000)
lsof -ti:3000 | xargs kill

# Frontend (puerto 5173)
lsof -ti:5173 | xargs kill
```

## 📄 Licencia

MIT

## 👨‍💻 Autor

Desarrollado con Vue 3, TypeScript y las últimas tecnologías web.

---

**Última actualización:** 2026-01-29
**Versión:** 0.0.1
**Estado:** Sprint 2 (95% completado)
