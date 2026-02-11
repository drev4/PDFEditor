# 📦 Guía de Migración a AcroForms

Esta guía explica cómo migrar formularios existentes para embeber sus campos en los PDFs como AcroForms.

---

## 📋 Tabla de Contenidos

1. [¿Qué hace la migración?](#qué-hace-la-migración)
2. [Pre-requisitos](#pre-requisitos)
3. [Modo Dry-Run (Simulación)](#modo-dry-run-simulación)
4. [Migración en Producción](#migración-en-producción)
5. [Migración de un formulario específico](#migración-de-un-formulario-específico)
6. [Verificación](#verificación)
7. [Rollback](#rollback)
8. [Troubleshooting](#troubleshooting)

---

## ¿Qué hace la migración?

El script de migración:

1. ✅ Busca formularios con campos en la base de datos
2. ✅ Verifica que tengan un PDF asociado
3. ✅ Lee el PDF del sistema de archivos
4. ✅ Embebe los campos en el PDF como AcroForms estándar
5. ✅ Crea un backup del PDF original (`.backup.pdf`)
6. ✅ Guarda el PDF modificado
7. ✅ Verifica que los campos se embebieron correctamente

### Lo que NO hace:

- ❌ No modifica la base de datos
- ❌ No elimina campos de la BD
- ❌ No cambia el comportamiento de la aplicación
- ❌ No afecta formularios nuevos (ya se crean con AcroForms)

---

## Pre-requisitos

### 1. Backup de la Base de Datos

```bash
# PostgreSQL
pg_dump vuepdf > backup_vuepdf_$(date +%Y%m%d).sql

# O usa tu método preferido de backup
```

### 2. Backup de los PDFs

```bash
cd backend/uploads/pdfs
tar -czf pdfs_backup_$(date +%Y%m%d).tar.gz *.pdf
```

### 3. Compilar el Backend

```bash
cd backend
npm run build
```

---

## Modo Dry-Run (Simulación)

**⚠️ IMPORTANTE:** Siempre ejecuta primero en modo dry-run para ver qué pasará.

```bash
cd backend
npm run migrate:dry-run
```

### Salida Esperada:

```
🚀 Iniciando migración de formularios a AcroForms...

Modo: 🔍 DRY RUN (simulación)

📊 Formularios encontrados: 15

[1/15] Procesando formulario: Solicitud de Empleo
   ID: abc-123-def
   Campos: 8
   📄 PDF: solicitud-empleo.pdf
   📖 PDF leído: 245.32 KB
   🔨 Embebiendo 8 campos...
   ✅ Campos embebidos exitosamente
   ✔️  Verificación: 8 campos detectados en PDF
   🔍 DRY RUN: No se modificó el archivo
   ✅ MIGRADO EXITOSAMENTE

...

============================================================
📊 RESUMEN DE MIGRACIÓN
============================================================
Total de formularios:     15
✅ Migrados exitosamente: 12
⏭️  Omitidos (skip):       2
❌ Fallidos:              1
============================================================

🔍 Esto fue una simulación. Ejecuta sin --dry-run para aplicar cambios.
```

### Razones de Skip:

- **"No tiene PDF URL"**: El formulario no tiene PDF asociado
- **"No tiene campos"**: El formulario está vacío
- **"PDF ya tiene X campos embebidos"**: Ya fue migrado anteriormente

---

## Migración en Producción

Una vez verificado el dry-run, ejecuta la migración real:

```bash
cd backend
npm run migrate:run
```

**⚠️ ADVERTENCIA:** Esto modifica los archivos PDF. Asegúrate de tener backups.

### Durante la Migración:

- ✅ Se crean backups automáticos (`.backup.pdf`)
- ✅ Si un formulario falla, los demás continúan
- ✅ El log muestra progreso en tiempo real
- ✅ Al final se muestra un resumen completo

---

## Migración de un formulario específico

Para migrar solo un formulario (útil para testing):

```bash
# Dry-run de un formulario
cd backend
npm run build
node dist/scripts/migrate-existing-forms.js --dry-run --form-id=abc-123-def

# Migración real de un formulario
node dist/scripts/migrate-existing-forms.js --form-id=abc-123-def
```

---

## Verificación

### 1. Verificar en Adobe Reader

1. Descarga un PDF migrado
2. Ábrelo en Adobe Acrobat Reader
3. Verifica que los campos son editables
4. Los campos deberían aparecer con bordes y ser interactivos

### 2. Verificar en la Aplicación

1. Abre el formulario en tu app
2. Los campos deberían cargarse automáticamente desde el PDF
3. Edita y guarda - debería funcionar normalmente

### 3. Verificar Logs del Backend

El endpoint GET de formularios debería mostrar:

```
PDF uploaded with 8 extracted fields
```

Cuando carga un formulario migrado.

---

## Rollback

Si necesitas revertir la migración:

### Opción 1: Restaurar desde Backups Automáticos

```bash
cd backend/uploads/pdfs

# Ver backups disponibles
ls *.backup.pdf

# Restaurar un PDF específico
mv solicitud-empleo.backup.pdf solicitud-empleo.pdf

# Restaurar todos
for file in *.backup.pdf; do
  mv "$file" "${file%.backup.pdf}.pdf"
done
```

### Opción 2: Restaurar desde Backup Manual

```bash
cd backend/uploads/pdfs
tar -xzf pdfs_backup_20260129.tar.gz
```

### Limpiar Backups Después de Verificar

```bash
cd backend/uploads/pdfs
rm *.backup.pdf
```

---

## Troubleshooting

### Error: "PDF file not found"

**Causa:** El archivo PDF no existe en el sistema de archivos.

**Solución:**
1. Verifica que la ruta del PDF en la BD es correcta
2. Verifica que el archivo existe en `backend/uploads/pdfs/`
3. Si falta, restaura desde backup o re-sube el PDF

### Error: "Verification failed: Expected X fields, found Y"

**Causa:** No todos los campos se embebieron correctamente.

**Solución:**
1. Revisa el PDF original - puede estar corrupto
2. Verifica que los campos tienen posiciones válidas
3. Intenta migrar ese formulario individual con más logging
4. Si persiste, reporta el bug con el PDF de ejemplo

### Error: "Invalid PDF file"

**Causa:** El PDF está corrupto o no es válido.

**Solución:**
1. Intenta abrir el PDF en Adobe Reader
2. Si no abre, el PDF está corrupto
3. Re-genera o re-sube el PDF
4. Vuelve a intentar la migración

### Formulario Omitido: "PDF ya tiene X campos embebidos"

**Causa:** El formulario ya fue migrado anteriormente.

**Solución:**
- ✅ Esto es correcto - no necesita migración
- Si quieres re-migrar, elimina los campos del PDF primero
- O simplemente déjalo - está funcionando correctamente

### No se encontraron formularios

**Causa:** Todos los formularios ya fueron migrados o no cumplen criterios.

**Solución:**
- ✅ Esto está bien - significa que no hay trabajo por hacer
- Verifica en la BD que hay formularios con campos
- Verifica que tienen `pdfUrl` no nulo

---

## Comandos Rápidos

```bash
# Ver cuántos formularios se migrarían
npm run migrate:dry-run | grep "Total de formularios"

# Migrar todo
npm run migrate:run

# Migrar un formulario específico
node dist/scripts/migrate-existing-forms.js --form-id=<ID>

# Ver logs detallados
npm run migrate:run 2>&1 | tee migration.log

# Limpiar backups después de verificar (CUIDADO)
cd uploads/pdfs && rm *.backup.pdf
```

---

## Mejores Prácticas

### Antes de Migrar:

1. ✅ Hacer backup de base de datos
2. ✅ Hacer backup de PDFs
3. ✅ Ejecutar dry-run primero
4. ✅ Probar con un formulario individual
5. ✅ Verificar en horario de baja actividad

### Durante la Migración:

1. ✅ Monitorear logs en tiempo real
2. ✅ No interrumpir el proceso
3. ✅ Guardar logs para referencia

### Después de Migrar:

1. ✅ Verificar con Adobe Reader
2. ✅ Probar en la aplicación
3. ✅ Guardar backups al menos 7 días
4. ✅ Monitorear errores en producción

---

## Soporte

Si encuentras problemas durante la migración:

1. Revisa esta guía de troubleshooting
2. Revisa los logs de la migración
3. Verifica los backups antes de hacer rollback
4. Documenta el error con logs y ejemplos

---

## Notas Adicionales

### Performance

- ⚡ La migración procesa ~1-2 formularios por segundo
- 📊 Para 100 formularios: ~1-2 minutos
- 💾 Cada PDF modificado es ~igual tamaño que original

### Seguridad

- 🔒 Los backups tienen los mismos permisos que originales
- 🔒 No se expone información sensible en logs
- 🔒 La migración requiere acceso al sistema de archivos

### Compatibilidad

- ✅ Compatible con Adobe Acrobat Reader
- ✅ Compatible con Preview (macOS)
- ✅ Compatible con Chrome PDF viewer
- ✅ Compatible con Firefox PDF viewer

---

**Última actualización:** 2026-01-29
**Versión del script:** 1.0.0
