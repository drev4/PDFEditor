# AcroForms Migration Guide

This guide explains how to migrate existing forms to embed their fields into the PDFs as AcroForms.

---

## Table of Contents

1. [What does the migration do?](#what-does-the-migration-do)
2. [Prerequisites](#prerequisites)
3. [Dry-Run Mode (Simulation)](#dry-run-mode-simulation)
4. [Production Migration](#production-migration)
5. [Migrating a specific form](#migrating-a-specific-form)
6. [Verification](#verification)
7. [Rollback](#rollback)
8. [Troubleshooting](#troubleshooting)

---

## What does the migration do?

The migration script:

1. Looks up forms with fields in the database
2. Verifies they have an associated PDF
3. Reads the PDF from the filesystem
4. Embeds the fields into the PDF as standard AcroForms
5. Creates a backup of the original PDF (`.backup.pdf`)
6. Saves the modified PDF
7. Verifies the fields were embedded correctly

### What it does NOT do:

- Does not modify the database
- Does not delete fields from the DB
- Does not change the application's behavior
- Does not affect new forms (already created with AcroForms)

---

## Prerequisites

### 1. Database Backup

```bash
# PostgreSQL
pg_dump vuepdf > backup_vuepdf_$(date +%Y%m%d).sql

# Or use your preferred backup method
```

### 2. PDF Backup

```bash
cd backend/uploads/pdfs
tar -czf pdfs_backup_$(date +%Y%m%d).tar.gz *.pdf
```

### 3. Build the Backend

```bash
cd backend
npm run build
```

---

## Dry-Run Mode (Simulation)

**IMPORTANT:** Always run in dry-run mode first to preview what will happen.

```bash
cd backend
npm run migrate:dry-run
```

### Expected Output:

```
Starting form migration to AcroForms...

Mode: DRY RUN (simulation)

Forms found: 15

[1/15] Processing form: Job Application
   ID: abc-123-def
   Fields: 8
   PDF: job-application.pdf
   PDF read: 245.32 KB
   Embedding 8 fields...
   Fields embedded successfully
   Verification: 8 fields detected in PDF
   DRY RUN: File was not modified
   MIGRATED SUCCESSFULLY

...

============================================================
MIGRATION SUMMARY
============================================================
Total forms:               15
Migrated successfully:     12
Skipped:                   2
Failed:                    1
============================================================

This was a simulation. Run without --dry-run to apply changes.
```

### Skip Reasons:

- **"No PDF URL"**: The form has no associated PDF
- **"No fields"**: The form is empty
- **"PDF already has X embedded fields"**: Already migrated previously

---

## Production Migration

Once the dry-run has been verified, run the actual migration:

```bash
cd backend
npm run migrate:run
```

**WARNING:** This modifies the PDF files. Make sure you have backups.

### During the Migration:

- Automatic backups are created (`.backup.pdf`)
- If one form fails, the others continue
- The log shows real-time progress
- A full summary is shown at the end

---

## Migrating a specific form

To migrate only one form (useful for testing):

```bash
# Dry-run for a single form
cd backend
npm run build
node dist/scripts/migrate-existing-forms.js --dry-run --form-id=abc-123-def

# Actual migration for a single form
node dist/scripts/migrate-existing-forms.js --form-id=abc-123-def
```

---

## Verification

### 1. Verify in Adobe Reader

1. Download a migrated PDF
2. Open it in Adobe Acrobat Reader
3. Verify the fields are editable
4. The fields should appear with borders and be interactive

### 2. Verify in the Application

1. Open the form in your app
2. The fields should load automatically from the PDF
3. Edit and save - it should work normally

### 3. Verify Backend Logs

The forms GET endpoint should show:

```
PDF uploaded with 8 extracted fields
```

When loading a migrated form.

---

## Rollback

If you need to revert the migration:

### Option 1: Restore from Automatic Backups

```bash
cd backend/uploads/pdfs

# List available backups
ls *.backup.pdf

# Restore a specific PDF
mv job-application.backup.pdf job-application.pdf

# Restore all
for file in *.backup.pdf; do
  mv "$file" "${file%.backup.pdf}.pdf"
done
```

### Option 2: Restore from Manual Backup

```bash
cd backend/uploads/pdfs
tar -xzf pdfs_backup_20260129.tar.gz
```

### Clean Up Backups After Verifying

```bash
cd backend/uploads/pdfs
rm *.backup.pdf
```

---

## Troubleshooting

### Error: "PDF file not found"

**Cause:** The PDF file does not exist on the filesystem.

**Solution:**
1. Verify the PDF path in the DB is correct
2. Verify the file exists at `backend/uploads/pdfs/`
3. If missing, restore from backup or re-upload the PDF

### Error: "Verification failed: Expected X fields, found Y"

**Cause:** Not all fields were embedded correctly.

**Solution:**
1. Check the original PDF - it may be corrupted
2. Verify the fields have valid positions
3. Try migrating that individual form with more logging
4. If it persists, report the bug with a sample PDF

### Error: "Invalid PDF file"

**Cause:** The PDF is corrupted or invalid.

**Solution:**
1. Try opening the PDF in Adobe Reader
2. If it won't open, the PDF is corrupted
3. Regenerate or re-upload the PDF
4. Retry the migration

### Form Skipped: "PDF already has X embedded fields"

**Cause:** The form was already migrated previously.

**Solution:**
- This is expected - no migration needed
- If you want to re-migrate, remove the fields from the PDF first
- Or simply leave it - it's working correctly

### No forms found

**Cause:** All forms have already been migrated or none meet the criteria.

**Solution:**
- This is fine - it means there is no work to do
- Verify in the DB that there are forms with fields
- Verify they have a non-null `pdfUrl`

---

## Quick Commands

```bash
# See how many forms would be migrated
npm run migrate:dry-run | grep "Total forms"

# Migrate everything
npm run migrate:run

# Migrate a specific form
node dist/scripts/migrate-existing-forms.js --form-id=<ID>

# View detailed logs
npm run migrate:run 2>&1 | tee migration.log

# Clean up backups after verifying (CAUTION)
cd uploads/pdfs && rm *.backup.pdf
```

---

## Best Practices

### Before Migrating:

1. Back up the database
2. Back up the PDFs
3. Run a dry-run first
4. Test with a single form
5. Run during low-traffic hours

### During the Migration:

1. Monitor logs in real time
2. Do not interrupt the process
3. Save logs for reference

### After Migrating:

1. Verify with Adobe Reader
2. Test in the application
3. Keep backups for at least 7 days
4. Monitor errors in production

---

## Support

If you run into problems during the migration:

1. Review this troubleshooting guide
2. Review the migration logs
3. Verify backups before rolling back
4. Document the error with logs and examples

---

## Additional Notes

### Performance

- The migration processes ~1-2 forms per second
- For 100 forms: ~1-2 minutes
- Each modified PDF is roughly the same size as the original

### Security

- Backups have the same permissions as the originals
- No sensitive information is exposed in logs
- The migration requires filesystem access

### Compatibility

- Compatible with Adobe Acrobat Reader
- Compatible with Preview (macOS)
- Compatible with Chrome PDF viewer
- Compatible with Firefox PDF viewer

---

**Last updated:** 2026-01-29
**Script version:** 1.0.0
