# PDF Upload System - Guide

## Overview

The PDF upload system allows users to upload PDF files to the server with progress tracking and error handling. Files are stored locally in the `backend/uploads/pdfs/` directory and served statically.

## Architecture

### Backend

- **Middleware**: `multer` for handling multipart/form-data
- **Storage**: Local filesystem (`backend/uploads/pdfs/`)
- **File size limit**: 10MB
- **Allowed types**: PDF only (`application/pdf`)
- **Endpoint**: `POST /api/upload`

### Frontend

- **Service**: `uploadService` - Low-level upload API with XMLHttpRequest
- **Composable**: `usePDFUpload` - Reactive upload state management
- **Integration**: `useFormManagement` - Form-specific upload logic
- **Components**:
  - `UploadProgress.vue` - Visual progress indicator
  - `PDFUploadButton.vue` - Ready-to-use upload button

## Usage Examples

### 1. Using the Upload Button Component

```vue
<template>
  <PDFUploadButton
    button-text="Upload Form Template"
    @upload-success="handleUploadSuccess"
    @upload-error="handleUploadError"
  />
</template>

<script setup lang="ts">
import PDFUploadButton from '@/components/forms/PDFUploadButton.vue'

function handleUploadSuccess(url: string) {
  console.log('PDF uploaded successfully:', url)
  // Use the URL to update your form
}

function handleUploadError(error: string) {
  console.error('Upload failed:', error)
}
</script>
```

### 2. Using the Composable Directly

```typescript
import { usePDFUpload } from '@/composables/usePDFUpload'

const { isUploading, uploadProgress, error, upload } = usePDFUpload()

async function handleFileUpload(file: File) {
  try {
    const url = await upload(file)
    console.log('PDF URL:', url)
  } catch (e) {
    console.error('Upload error:', error.value)
  }
}
```

### 3. Using with Form Management

```typescript
import { useFormManagement } from '@/composables/useFormManagement'

const { createFormForCurrentDocument, uploadPDFForCurrentForm } = useFormManagement()

// Create form with PDF upload
async function createNewForm(pdfFile: File) {
  const form = await createFormForCurrentDocument('My Form', pdfFile)
  console.log('Form created with PDF:', form.pdfUrl)
}

// Or upload PDF to existing form
async function addPDFToForm(pdfFile: File) {
  const url = await uploadPDFForCurrentForm(pdfFile)
  console.log('PDF added to current form:', url)
}
```

### 4. Manual Upload with Progress Tracking

```typescript
import { uploadService } from '@/services/upload'

async function uploadWithProgress(file: File) {
  try {
    const response = await uploadService.uploadPDF(file, (progress) => {
      console.log(`Upload progress: ${progress.percentage}%`)
      console.log(`Uploaded: ${progress.loaded} / ${progress.total} bytes`)
    })

    console.log('Upload complete:', response.url)
  } catch (error) {
    console.error('Upload failed:', error)
  }
}
```

## API Reference

### Backend Endpoint

**POST /api/upload**

- Authentication: Required (Bearer token)
- Content-Type: `multipart/form-data`
- Field name: `pdf`
- Max size: 10MB
- Allowed types: `application/pdf`

**Response (201 Created):**
```json
{
  "url": "http://localhost:3000/uploads/pdfs/eGKk4M-2Ov_f-1769629592137.pdf",
  "filename": "eGKk4M-2Ov_f-1769629592137.pdf",
  "size": 538
}
```

**Error Responses:**
- `400`: No file uploaded or invalid file type
- `401`: Unauthorized (missing/invalid token)
- `413`: File too large (>10MB)

### Frontend Service

**uploadService.uploadPDF(file, onProgress?)**

```typescript
interface UploadProgress {
  loaded: number
  total: number
  percentage: number
}

interface UploadResponse {
  url: string
  filename: string
  size: number
}

uploadService.uploadPDF(
  file: File,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadResponse>
```

### Composable

**usePDFUpload()**

```typescript
const {
  isUploading,      // ref<boolean> - Upload in progress
  uploadProgress,   // ref<UploadProgress | null> - Current progress
  error,            // ref<string | null> - Error message
  uploadedUrl,      // ref<string | null> - URL of uploaded file
  upload,           // (file: File) => Promise<string> - Upload function
  reset             // () => void - Reset state
} = usePDFUpload()
```

## File Structure

```
backend/
├── src/
│   ├── middleware/
│   │   └── upload.ts          # Multer configuration
│   └── routes/
│       └── upload.ts          # Upload endpoint
└── uploads/
    └── pdfs/
        └── .gitkeep           # Keep directory in git

frontend/
├── src/
│   ├── services/
│   │   └── upload.ts          # Upload service
│   ├── composables/
│   │   ├── usePDFUpload.ts    # Upload composable
│   │   └── useFormManagement.ts
│   └── components/
│       ├── ui/
│       │   └── UploadProgress.vue
│       └── forms/
│           └── PDFUploadButton.vue
```

## Security Considerations

1. **Authentication**: All uploads require valid JWT token
2. **File Validation**: Only PDF files are accepted (MIME type check)
3. **Size Limit**: Maximum 10MB per file
4. **Unique Filenames**: Generated with nanoid to prevent collisions
5. **Storage**: Files stored outside public web root

## Error Handling

The system provides comprehensive error handling:

- **Client-side validation**: File type and size checked before upload
- **Server-side validation**: Additional checks in multer middleware
- **Network errors**: Handled with proper error messages
- **User feedback**: Visual error messages in components

## Testing

Test the upload functionality:

```bash
# Create test user and get token
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"test123"}'

# Upload PDF (replace TOKEN with actual token)
curl -X POST http://localhost:3000/api/upload \
  -H "Authorization: Bearer TOKEN" \
  -F "pdf=@path/to/file.pdf"

# Access uploaded file
curl http://localhost:3000/uploads/pdfs/FILENAME.pdf
```

## Production Considerations

For production deployment, consider:

1. **Cloud Storage**: Migrate to S3/Azure Blob/GCP Storage
2. **CDN**: Serve uploaded files through CDN
3. **Virus Scanning**: Add antivirus scanning for uploads
4. **Image Processing**: Generate thumbnails/previews
5. **Backup**: Regular backups of uploaded files
6. **Monitoring**: Track upload success/failure rates

## Future Enhancements

- [ ] Drag & drop upload area
- [ ] Multiple file upload
- [ ] Resume interrupted uploads
- [ ] Client-side PDF preview
- [ ] Compression before upload
- [ ] Cloud storage integration (S3, Azure)
