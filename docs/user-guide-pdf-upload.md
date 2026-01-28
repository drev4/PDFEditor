# Guía de Usuario: Cómo Subir y Guardar Formularios PDF

## 📋 Flujo Completo de Trabajo

### Paso 1: Cargar PDF Localmente

1. **Inicia sesión** en la aplicación
2. En el Dashboard, haz clic en **"Upload PDF"** o arrastra un archivo PDF
3. El PDF se cargará en el visor (esto solo carga el archivo en tu navegador, NO en el servidor aún)

```
Dashboard → Upload PDF → Visor PDF
```

### Paso 2: Agregar Campos de Formulario

1. Con el PDF cargado, ve al panel derecho **"Form Fields"**
2. Selecciona el tipo de campo que quieres agregar:
   - Text (texto de una línea)
   - Textarea (texto multilínea)
   - Checkbox (casilla de verificación)
   - Radio (botones de opción)
   - Dropdown (lista desplegable)

3. Haz clic en el PDF donde quieres colocar el campo
4. Ajusta las propiedades del campo en el panel derecho:
   - Nombre del campo
   - Etiqueta
   - Si es requerido
   - Opciones (para radio y dropdown)

```
Form Fields Panel → Seleccionar tipo → Click en PDF → Configurar propiedades
```

### Paso 3: Guardar el Formulario en la Nube

Una vez que hayas agregado al menos un campo, aparecerá el panel **"Save Form"** en el editor:

1. **Introduce un título** para tu formulario (obligatorio)
2. Opcionalmente, agrega una **descripción**
3. Haz clic en **"Save Form to Cloud"**

El sistema automáticamente:
- ✅ Sube el PDF al servidor
- ✅ Crea el formulario en la base de datos
- ✅ Guarda todos los campos que creaste
- ✅ Genera un ID único para compartir

```
Save Form Panel → Título + Descripción → Save Form to Cloud
```

### Paso 4: Actualizar Campos (Formulario Ya Guardado)

Si ya guardaste el formulario y agregas o modificas campos:

1. El panel cambia a **"Form Saved"** mostrando el estado
2. Haz clic en **"Update Fields"** para guardar los cambios

```
Form Saved Panel → Modificar campos → Update Fields
```

### Paso 5: Subir PDF al Servidor (Opcional)

Si NO subiste el PDF al crear el formulario, puedes hacerlo después:

1. En el panel **"Form Saved"**, verás un botón **"Upload PDF"**
2. Haz clic y selecciona el archivo PDF actual
3. El sistema subirá el PDF y lo vinculará al formulario

```
Form Saved Panel → Upload PDF → Seleccionar archivo → Upload
```

## 🎯 Componentes de la Interfaz

### Dashboard View

```
┌─────────────────────────────────────────────────────┐
│ Header                                              │
│ [Logo] PDF Editor Pro    [Upload PDF] [Logout]     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Sin documentos:                                    │
│  ┌─────────────────────────────────────────────┐  │
│  │  📄 Upload Your PDF                          │  │
│  │  [Drag & Drop or Click to Upload]           │  │
│  └─────────────────────────────────────────────┘  │
│                                                     │
│  Con documento cargado:                            │
│  ├─ Sidebar: Documents/Pages                       │
│  ├─ Visor PDF (centro)                             │
│  └─ Editor Tools (derecha)                         │
│     ├─ Form Save Panel ⭐ NUEVO                    │
│     ├─ Search                                      │
│     ├─ Add Text                                    │
│     └─ Export PDF                                  │
└─────────────────────────────────────────────────────┘
```

### Form Save Panel (Antes de Guardar)

```
┌─────────────────────────────────────────────────┐
│ ⚠️ Save Form                                    │
├─────────────────────────────────────────────────┤
│ Save this PDF form to the cloud to access it   │
│ later and share with others.                    │
│                                                 │
│ ┌─────────────────────────────────────────────┐│
│ │ Form title...                               ││
│ └─────────────────────────────────────────────┘│
│                                                 │
│ ┌─────────────────────────────────────────────┐│
│ │ Description (optional)...                   ││
│ │                                             ││
│ └─────────────────────────────────────────────┘│
│                                                 │
│ [☁️ Save Form to Cloud]                         │
│                                                 │
│ ⚠️ Add at least one field before saving        │
└─────────────────────────────────────────────────┘
```

### Form Save Panel (Después de Guardar)

```
┌─────────────────────────────────────────────────┐
│ ✅ Form Saved                                   │
│ ID: abc123-def456-...                           │
├─────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────┐│
│ │ My Contact Form                             ││
│ │ A simple contact form                       ││
│ │ 5 fields • draft                            ││
│ └─────────────────────────────────────────────┘│
│                                                 │
│ [💾 Update Fields]                              │
│                                                 │
│ [☁️ Upload PDF]  (si no se subió antes)         │
│                                                 │
│ O si ya se subió:                               │
│ ┌─────────────────────────────────────────────┐│
│ │ 📄 PDF Uploaded                             ││
│ │ eGKk4M-2Ov_f-1769629592137.pdf              ││
│ └─────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
```

### Upload Progress Toast

Cuando subes un PDF, aparece una notificación flotante mostrando el progreso:

```
┌─────────────────────────────────────────┐
│ 📄  sample.pdf                          │
│     Uploading...                        │
│                                         │
│ ████████████░░░░░░░░░░ 65%             │
│                                         │
│ 65%                    3.2 MB / 5 MB   │
└─────────────────────────────────────────┘
```

## 🔄 Estados del Formulario

### 1. Sin Formulario Guardado
- Panel muestra "Save Form"
- Botón: "Save Form to Cloud"
- Acción: Crear formulario nuevo + subir PDF

### 2. Formulario Guardado (Con PDF)
- Panel muestra "Form Saved" ✅
- Muestra información del formulario
- Muestra "PDF Uploaded" con nombre del archivo
- Botón: "Update Fields" (para actualizar campos)

### 3. Formulario Guardado (Sin PDF)
- Panel muestra "Form Saved" ✅
- Botón adicional: "Upload PDF"
- Permite subir el PDF posteriormente

## 💡 Casos de Uso Comunes

### Caso 1: Crear Formulario Nuevo con TODO
```
1. Upload PDF → Visor carga el archivo
2. Agregar campos de formulario
3. Click "Save Form to Cloud"
   ✅ PDF se sube automáticamente
   ✅ Formulario se crea en DB
   ✅ Campos se guardan
```

### Caso 2: Modificar Formulario Existente
```
1. Cargar formulario desde lista de formularios
2. Modificar o agregar campos
3. Click "Update Fields"
   ✅ Cambios se guardan en DB
```

### Caso 3: Subir PDF Después
```
1. Crear formulario sin subir PDF
2. Más tarde, click "Upload PDF"
3. Seleccionar archivo PDF
   ✅ PDF se sube al servidor
   ✅ URL se vincula al formulario
```

## ⚙️ Configuración Técnica

### Variables de Entorno

Backend (.env):
```bash
BASE_URL=http://localhost:3000
```

Frontend (.env):
```bash
VITE_API_URL=http://localhost:3000/api
```

### Límites

- Tamaño máximo de PDF: **10MB**
- Tipos de archivo aceptados: **Solo PDF** (`application/pdf`)
- Autenticación: **Requerida** (JWT token)

## 🐛 Solución de Problemas

### "No se puede guardar el formulario"
- ✅ Verifica que hayas agregado al menos un campo
- ✅ Verifica que el título no esté vacío
- ✅ Verifica tu conexión a internet

### "Error al subir PDF"
- ✅ Verifica que el archivo sea un PDF válido
- ✅ Verifica que no exceda 10MB
- ✅ Verifica que estés autenticado

### "Los campos no se actualizan"
- ✅ Verifica que el formulario esté guardado primero
- ✅ Verifica tu conexión al servidor
- ✅ Revisa la consola del navegador para errores

## 📊 Ejemplo Completo

```javascript
// Flujo programático (para desarrolladores)

// 1. Usuario carga PDF localmente
await documentStore.loadPDF(pdfFile)

// 2. Usuario agrega campos
formFieldsStore.addField({
  type: 'text',
  name: 'email',
  label: 'Email Address',
  required: true,
  position: { x: 100, y: 200, width: 200, height: 30, page: 1 }
})

// 3. Usuario guarda formulario (esto sube el PDF automáticamente)
const form = await formManagement.createFormForCurrentDocument(
  'Contact Form',  // título
  pdfFile          // archivo PDF (opcional)
)

// 4. Usuario modifica campos
formFieldsStore.updateField(fieldId, { required: false })

// 5. Usuario actualiza campos en servidor
await formFieldsStore.saveAllFields()

// 6. (Opcional) Subir PDF si no se hizo antes
await formManagement.uploadPDFForCurrentForm(pdfFile)
```

## 🎨 Personalización

### Cambiar Límite de Tamaño

Backend (`backend/src/middleware/upload.ts`):
```typescript
limits: {
  fileSize: 20 * 1024 * 1024 // 20MB
}
```

### Cambiar Directorio de Upload

Backend (`backend/src/middleware/upload.ts`):
```typescript
const uploadsDir = path.join(process.cwd(), 'uploads', 'pdfs')
```

### Agregar Validaciones Adicionales

Frontend (`frontend/src/services/upload.ts`):
```typescript
// Agregar validación personalizada
if (file.name.includes('test')) {
  throw new UploadError(400, 'Test files not allowed')
}
```

## 🚀 Próximos Pasos

Después de subir y guardar tu formulario:

1. **Compartir**: Obtén el `shareId` para compartir el formulario
2. **Ver respuestas**: Accede al dashboard de respuestas
3. **Publicar**: Cambia el estado a "published"
4. **Exportar**: Descarga el PDF con campos completados

---

**¿Necesitas ayuda?** Consulta la [documentación técnica](./pdf-upload-guide.md) para más detalles.
