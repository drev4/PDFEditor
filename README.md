# VuePDF Editor

Editor y visualizador de PDFs desarrollado con Vue 3, TypeScript, Pinia, PrimeVue, Tailwind CSS, PDF.js y pdf-lib.

## Características

- **Visualización de PDFs**: Visualiza documentos PDF con controles de navegación
- **Zoom y Rotación**: Controla el nivel de zoom y rota las páginas
- **Edición de PDFs**:
  - Añadir texto personalizado con diferentes tamaños y colores
  - Insertar imágenes (PNG, JPG)
  - Eliminar páginas
  - Añadir páginas en blanco
- **Gestión de múltiples documentos**: Abre y alterna entre varios PDFs
- **Historial de ediciones**: Seguimiento de cambios realizados
- **Exportación**: Descarga el PDF modificado

## Tecnologías Utilizadas

- **Vue 3** - Framework progresivo de JavaScript
- **TypeScript** - Superset tipado de JavaScript
- **Vite** - Build tool y dev server ultra rápido
- **Pinia** - State management oficial para Vue
- **PrimeVue** - Librería de componentes UI rica y moderna
- **Tailwind CSS** - Framework CSS utility-first
- **PDF.js** - Renderizado de PDFs (Mozilla)
- **pdf-lib** - Creación y modificación de PDFs

## Instalación

```bash
# Instalar dependencias
npm install

# Ejecutar en modo desarrollo
npm run dev

# Build para producción
npm run build

# Preview del build de producción
npm run preview
```

## Estructura del Proyecto

```
VuePDF/
├── src/
│   ├── components/
│   │   ├── PDFViewer.vue       # Componente visualizador (refactorizado)
│   │   ├── PDFToolbar.vue      # Barra de herramientas de navegación
│   │   ├── ImageControls.vue   # Controles de manipulación de imágenes
│   │   ├── PDFEditor.vue       # Panel de herramientas de edición
│   │   └── FileUploader.vue    # Componente para cargar archivos
│   ├── composables/            # Lógica reutilizable
│   │   ├── usePDFRendering.ts  # Renderizado de PDF
│   │   ├── usePDFSearch.ts     # Búsqueda de texto
│   │   ├── useImagePlacement.ts # Manejo de imágenes
│   │   └── useGridOverlay.ts   # Grid de ayuda
│   ├── stores/
│   │   └── pdfStore.ts         # Store de Pinia para PDFs
│   ├── types/
│   │   └── pdf.ts              # Tipos TypeScript
│   ├── App.vue                 # Componente principal
│   ├── main.ts                 # Punto de entrada
│   └── style.css               # Estilos globales
├── public/
├── REFACTORING.md              # Documentación de refactorización
├── index.html
├── vite.config.ts
├── tailwind.config.js
└── package.json
```

## Uso

1. **Abrir PDF**: Haz clic en "Open PDF" en la cabecera y selecciona un archivo PDF
2. **Navegar**: Usa los botones de navegación para moverte entre páginas
3. **Zoom**: Usa los botones + y - para acercar o alejar
4. **Rotar**: Haz clic en el botón de rotación para rotar la página
5. **Añadir Texto**:
   - Escribe el texto en el campo
   - Ajusta el tamaño y color
   - Haz clic en "Add Text to PDF"
6. **Añadir Imagen**: Selecciona una imagen desde tu computadora
7. **Gestionar Páginas**: Elimina o añade páginas según necesites
8. **Exportar**: Descarga el PDF modificado con el botón "Download Modified PDF"

## Características Técnicas

- **Arquitectura Modular**: Composables reutilizables siguiendo principios SOLID
- **Reactive State Management**: Uso de Pinia para gestión de estado global
- **Composition API**: Vue 3 con script setup para mejor performance
- **Type Safety**: TypeScript en todo el proyecto
- **Diseño Profesional SaaS**: Interfaz moderna con glassmorphism y animaciones
- **Modern UI Components**: PrimeVue con tema personalizado
- **Canvas Rendering**: Renderizado eficiente de PDFs con PDF.js
- **Text Search**: Búsqueda de texto con resaltado visual
- **Grid System**: Sistema de grilla con snap-to-grid
- **Image Manipulation**: Drag & drop, resize, flip de imágenes
- **Undo/Redo**: Sistema de historial de ediciones

## Arquitectura

El proyecto utiliza una arquitectura basada en composables para separar responsabilidades:

- **Composables**: Lógica de negocio reutilizable y testeable
- **Componentes**: UI presentacional que usa los composables
- **Store**: Estado global centralizado con Pinia
- **Types**: Definiciones de TypeScript compartidas

Para más detalles sobre la arquitectura, ver [REFACTORING.md](REFACTORING.md)

## Mejoras Futuras

- [x] ✅ Búsqueda de texto en PDF (completado)
- [x] ✅ Grid con snap-to-grid (completado)
- [x] ✅ Diseño profesional SaaS (completado)
- [ ] Soporte para anotaciones y dibujo libre
- [ ] Firma digital
- [ ] Fusionar múltiples PDFs
- [ ] Extraer páginas específicas
- [ ] OCR (Reconocimiento de texto)
- [ ] Modo oscuro
- [ ] Atajos de teclado
- [ ] Vista de miniaturas

## Licencia

MIT

## Autor

Desarrollado con Vue 3 y las últimas tecnologías web
