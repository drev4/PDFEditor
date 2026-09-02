import { PrismaClient } from '@prisma/client'
import { pdfProcessor } from '../services/pdf-processor.js'
import { pdfFilenameFrom } from '../services/pdf-url.js'
import { pdfStorage } from '../services/pdf-storage.js'

const prisma = new PrismaClient()

interface MigrationStats {
  total: number
  migrated: number
  skipped: number
  failed: number
  errors: Array<{ formId: string; error: string }>
}

/**
 * Script de migración de formularios existentes a AcroForms
 *
 * Este script:
 * 1. Busca formularios con campos en BD pero sin campos embebidos en el PDF
 * 2. Embebe los campos del BD en el PDF
 * 3. Actualiza el archivo PDF en el sistema
 *
 * USO:
 *   npm run build
 *   node dist/scripts/migrate-existing-forms.js [--dry-run]
 *
 * Flags:
 *   --dry-run: Simula la migración sin modificar archivos
 *   --form-id=<id>: Migra solo un formulario específico
 */
async function migrateExistingForms(options: { dryRun?: boolean; formId?: string } = {}) {
  const { dryRun = false, formId } = options

  console.log('\n🚀 Iniciando migración de formularios a AcroForms...\n')
  console.log(`Modo: ${dryRun ? '🔍 DRY RUN (simulación)' : '✍️  PRODUCCIÓN (modifica archivos)'}\n`)

  const stats: MigrationStats = {
    total: 0,
    migrated: 0,
    skipped: 0,
    failed: 0,
    errors: []
  }

  try {
    // 1. Obtener formularios a migrar
    const whereClause = formId
      ? { id: formId }
      : {
          pdfUrl: { not: null },
          fields: { some: { deletedAt: null } } // Tiene al menos un campo activo
        }

    const forms = await prisma.form.findMany({
      where: whereClause,
      include: {
        // Solo campos activos: un campo archivado no debe volver a incrustarse
        // en el PDF.
        fields: {
          where: { deletedAt: null },
          orderBy: { order: 'asc' }
        }
      }
    })

    stats.total = forms.length
    console.log(`📊 Formularios encontrados: ${stats.total}\n`)

    if (stats.total === 0) {
      console.log('✅ No hay formularios para migrar\n')
      return stats
    }

    // 2. Migrar cada formulario
    for (const form of forms) {
      const formNumber = stats.migrated + stats.skipped + stats.failed + 1
      console.log(`\n[${formNumber}/${stats.total}] Procesando formulario: ${form.title}`)
      console.log(`   ID: ${form.id}`)
      console.log(`   Campos: ${form.fields.length}`)

      // Validar que tiene PDF
      if (!form.pdfUrl) {
        console.log('   ⏭️  SKIPPED: No tiene PDF URL')
        stats.skipped++
        continue
      }

      // Validar que tiene campos
      if (form.fields.length === 0) {
        console.log('   ⏭️  SKIPPED: No tiene campos para migrar')
        stats.skipped++
        continue
      }

      try {
        // Construir ruta del PDF
        const filename = pdfFilenameFrom(form.pdfUrl)
        if (!filename) {
          throw new Error(`Unrecognised PDF URL: ${form.pdfUrl}`)
        }
        // A traves del servicio de almacenamiento, no del disco: este script es
        // el unico sitio que toca los PDF sin que ninguna prueba lo cubra, asi
        // que es el que se rompe en silencio si se queda atras (features/0016).
        if (!(await pdfStorage().exists(filename))) {
          throw new Error(`PDF not found in storage: ${filename}`)
        }

        console.log(`   📄 PDF: ${filename}`)

        // Leer el PDF
        const pdfBuffer = await pdfStorage().get(filename)
        console.log(`   📖 PDF leído: ${(pdfBuffer.length / 1024).toFixed(2)} KB`)

        // Verificar si ya tiene campos embebidos
        try {
          const existingFields = await pdfProcessor.extractFieldsFromPDF(pdfBuffer)
          if (existingFields.length > 0) {
            console.log(`   ⏭️  SKIPPED: PDF ya tiene ${existingFields.length} campos embebidos`)
            stats.skipped++
            continue
          }
        } catch (e) {
          // Si falla la extracción, continuar con el embebido
          console.log('   ℹ️  PDF no tiene campos (o no se pudieron extraer)')
        }

        // Preparar campos para embeber
        const fieldsToEmbed = form.fields.map(field => ({
          type: field.type as any,
          name: field.name,
          label: field.label,
          required: field.required,
          position: field.position as any,
          options: field.options as string[] | undefined,
          validation: field.validation as any
        }))

        console.log(`   🔨 Embebiendo ${fieldsToEmbed.length} campos...`)

        // Embeber campos en el PDF
        const modifiedPdfBuffer = await pdfProcessor.embedFieldsInPDF(pdfBuffer, fieldsToEmbed)
        console.log(`   ✅ Campos embebidos exitosamente`)

        // Verificar que se embebieron correctamente
        const verificationFields = await pdfProcessor.extractFieldsFromPDF(modifiedPdfBuffer)
        console.log(`   ✔️  Verificación: ${verificationFields.length} campos detectados en PDF`)

        if (verificationFields.length !== fieldsToEmbed.length) {
          throw new Error(
            `Verification failed: Expected ${fieldsToEmbed.length} fields, found ${verificationFields.length}`
          )
        }

        // Guardar el PDF modificado (solo si no es dry-run)
        if (!dryRun) {
          // Backup del original, con guion y no con punto: la clave de
          // almacenamiento es `[A-Za-z0-9_-]+.pdf` en `pdf-storage.ts` y en
          // `pdf-url.ts`, asi que `x.backup.pdf` no es un nombre que este
          // servicio pueda emitir ni servir. Un solo alfabeto en los tres
          // sitios (features/0016).
          const backupKey = filename.replace(/\.pdf$/, '-backup.pdf')
          await pdfStorage().put(backupKey, pdfBuffer)
          console.log(`   💾 Backup creado: ${backupKey}`)

          // Guardar PDF modificado
          await pdfStorage().put(filename, modifiedPdfBuffer)
          console.log(`   💾 PDF actualizado: ${filename}`)
        } else {
          console.log(`   🔍 DRY RUN: No se modificó el archivo`)
        }

        stats.migrated++
        console.log(`   ✅ MIGRADO EXITOSAMENTE`)

      } catch (error) {
        stats.failed++
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        console.log(`   ❌ ERROR: ${errorMessage}`)
        stats.errors.push({
          formId: form.id,
          error: errorMessage
        })
      }
    }

    // 3. Mostrar resumen
    console.log('\n' + '='.repeat(60))
    console.log('📊 RESUMEN DE MIGRACIÓN')
    console.log('='.repeat(60))
    console.log(`Total de formularios:     ${stats.total}`)
    console.log(`✅ Migrados exitosamente: ${stats.migrated}`)
    console.log(`⏭️  Omitidos (skip):       ${stats.skipped}`)
    console.log(`❌ Fallidos:              ${stats.failed}`)
    console.log('='.repeat(60))

    if (stats.errors.length > 0) {
      console.log('\n⚠️  ERRORES DETALLADOS:')
      stats.errors.forEach(({ formId, error }) => {
        console.log(`   • Form ${formId}: ${error}`)
      })
    }

    if (!dryRun && stats.migrated > 0) {
      console.log('\n✅ Migración completada. Los PDFs originales tienen backup con extensión .backup.pdf')
    }

    if (dryRun) {
      console.log('\n🔍 Esto fue una simulación. Ejecuta sin --dry-run para aplicar cambios.')
    }

    console.log('')

    return stats

  } catch (error) {
    console.error('\n❌ Error fatal durante la migración:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Parsear argumentos de línea de comandos
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const formIdArg = args.find(arg => arg.startsWith('--form-id='))
const formId = formIdArg ? formIdArg.split('=')[1] : undefined

// Ejecutar migración
migrateExistingForms({ dryRun, formId })
  .then((stats) => {
    const exitCode = stats.failed > 0 ? 1 : 0
    process.exit(exitCode)
  })
  .catch((error) => {
    console.error('Script failed:', error)
    process.exit(1)
  })
