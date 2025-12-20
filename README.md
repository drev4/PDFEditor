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
│   │   ├── PDFViewer.vue       # Componente visualizador de PDF
│   │   ├── PDFEditor.vue       # Componente editor de PDF
│   │   └── FileUploader.vue    # Componente para cargar archivos
│   ├── stores/
│   │   └── pdfStore.ts         # Store de Pinia para PDFs
│   ├── types/
│   │   └── pdf.ts              # Tipos TypeScript
│   ├── App.vue                 # Componente principal
│   ├── main.ts                 # Punto de entrada
│   └── style.css               # Estilos globales
├── public/
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

- **Reactive State Management**: Uso de Pinia para gestión de estado global
- **Persistent Storage**: Los documentos abiertos persisten entre sesiones
- **Type Safety**: TypeScript para seguridad de tipos en todo el proyecto
- **Responsive Design**: Interfaz adaptable con Tailwind CSS
- **Modern UI Components**: Uso de PrimeVue con tema Aura
- **Canvas Rendering**: Renderizado eficiente de PDFs usando canvas

## Mejoras Futuras

- [ ] Soporte para anotaciones y dibujo libre
- [ ] Firma digital
- [ ] Fusionar múltiples PDFs
- [ ] Extraer páginas específicas
- [ ] OCR (Reconocimiento de texto)
- [ ] Modo oscuro
- [ ] Atajos de teclado
- [ ] Vista de miniaturas
- [ ] Búsqueda de texto en PDF

## Licencia

MIT

## Autor

Desarrollado con Vue 3 y las últimas tecnologías web
