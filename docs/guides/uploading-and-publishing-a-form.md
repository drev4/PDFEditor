# User Guide: How to Upload and Save PDF Forms

## Complete Workflow

### Step 1: Load a PDF Locally

1. **Sign in** to the application
2. On the Dashboard, click **"Upload PDF"** or drag and drop a PDF file
3. The PDF loads into the viewer (this only loads the file in your browser, NOT on the server yet)

```
Dashboard → Upload PDF → PDF Viewer
```

### Step 2: Add Form Fields

1. With the PDF loaded, go to the right-hand **"Form Fields"** panel
2. Select the field type you want to add:
   - Text (single-line text)
   - Textarea (multi-line text)
   - Checkbox
   - Radio (option buttons)
   - Dropdown (select list)

3. Click on the PDF where you want to place the field
4. Adjust the field's properties in the right-hand panel:
   - Field name
   - Label
   - Whether it's required
   - Options (for radio and dropdown)

```
Form Fields Panel → Select type → Click on PDF → Configure properties
```

### Step 3: Save the Form to the Cloud

Once you've added at least one field, the **"Save Form"** panel appears in the editor:

1. **Enter a title** for your form (required)
2. Optionally, add a **description**
3. Click **"Save Form to Cloud"**

The system automatically:
- Uploads the PDF to the server
- Creates the form in the database
- Saves all the fields you created
- Generates a unique ID for sharing

```
Save Form Panel → Title + Description → Save Form to Cloud
```

### Step 4: Update Fields (Form Already Saved)

If you've already saved the form and add or modify fields:

1. The panel switches to **"Form Saved"**, showing the current state
2. Click **"Update Fields"** to save the changes

```
Form Saved Panel → Modify fields → Update Fields
```

### Step 5: Upload PDF to the Server (Optional)

If you did NOT upload the PDF when creating the form, you can do so afterward:

1. In the **"Form Saved"** panel, you'll see an **"Upload PDF"** button
2. Click it and select the current PDF file
3. The system uploads the PDF and links it to the form

```
Form Saved Panel → Upload PDF → Select file → Upload
```

## Interface Components

### Dashboard View

```
┌─────────────────────────────────────────────────────┐
│ Header                                              │
│ [Logo] VuePDF Forms    [Upload PDF] [Logout]       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  No documents:                                      │
│  ┌─────────────────────────────────────────────┐  │
│  │  Upload Your PDF                             │  │
│  │  [Drag & Drop or Click to Upload]           │  │
│  └─────────────────────────────────────────────┘  │
│                                                     │
│  With a document loaded:                           │
│  ├─ Sidebar: Documents/Pages                       │
│  ├─ PDF Viewer (center)                            │
│  └─ Editor Tools (right)                           │
│     ├─ Form Save Panel                             │
│     ├─ Search                                      │
│     ├─ Add Text                                    │
│     └─ Export PDF                                  │
└─────────────────────────────────────────────────────┘
```

### Form Save Panel (Before Saving)

```
┌─────────────────────────────────────────────────┐
│ Save Form                                        │
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
│ [Save Form to Cloud]                            │
│                                                 │
│ Add at least one field before saving            │
└─────────────────────────────────────────────────┘
```

### Form Save Panel (After Saving)

```
┌─────────────────────────────────────────────────┐
│ Form Saved                                       │
│ ID: abc123-def456-...                           │
├─────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────┐│
│ │ My Contact Form                             ││
│ │ A simple contact form                       ││
│ │ 5 fields • draft                            ││
│ └─────────────────────────────────────────────┘│
│                                                 │
│ [Update Fields]                                 │
│                                                 │
│ [Upload PDF]  (if not uploaded yet)             │
│                                                 │
│ Or if already uploaded:                         │
│ ┌─────────────────────────────────────────────┐│
│ │ PDF Uploaded                                ││
│ │ eGKk4M-2Ov_f-1769629592137.pdf              ││
│ └─────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
```

### Upload Progress Toast

While uploading a PDF, a floating notification shows the progress:

```
┌─────────────────────────────────────────┐
│ sample.pdf                              │
│     Uploading...                        │
│                                         │
│ ████████████░░░░░░░░░░ 65%             │
│                                         │
│ 65%                    3.2 MB / 5 MB   │
└─────────────────────────────────────────┘
```

## Form States

### 1. No Form Saved
- Panel shows "Save Form"
- Button: "Save Form to Cloud"
- Action: Create a new form + upload PDF

### 2. Form Saved (With PDF)
- Panel shows "Form Saved"
- Displays form information
- Shows "PDF Uploaded" with the file name
- Button: "Update Fields" (to update fields)

### 3. Form Saved (Without PDF)
- Panel shows "Form Saved"
- Additional button: "Upload PDF"
- Allows uploading the PDF later

## Common Use Cases

### Case 1: Create a New Form from Scratch
```
1. Upload PDF → Viewer loads the file
2. Add form fields
3. Click "Save Form to Cloud"
   PDF is uploaded automatically
   Form is created in the DB
   Fields are saved
```

### Case 2: Modify an Existing Form
```
1. Load the form from the forms list
2. Modify or add fields
3. Click "Update Fields"
   Changes are saved in the DB
```

### Case 3: Upload the PDF Later
```
1. Create a form without uploading a PDF
2. Later, click "Upload PDF"
3. Select the PDF file
   PDF is uploaded to the server
   URL is linked to the form
```

## Technical Configuration

### Environment Variables

Backend (.env):
```bash
BASE_URL=http://localhost:3000
```

Frontend (.env):
```bash
VITE_API_URL=http://localhost:3000/api
```

### Limits

- Maximum PDF size: **10MB**
- Accepted file types: **PDF only** (`application/pdf`)
- Authentication: **Required** (JWT token)

## Troubleshooting

### "Cannot save the form"
- Verify you've added at least one field
- Verify the title is not empty
- Check your internet connection

### "Error uploading PDF"
- Verify the file is a valid PDF
- Verify it does not exceed 10MB
- Verify you are authenticated

### "Fields are not updating"
- Verify the form was saved first
- Check your connection to the server
- Check the browser console for errors

## Full Example

```javascript
// Programmatic flow (for developers)

// 1. User loads a PDF locally
await documentStore.loadPDF(pdfFile)

// 2. User adds fields
formFieldsStore.addField({
  type: 'text',
  name: 'email',
  label: 'Email Address',
  required: true,
  position: { x: 100, y: 200, width: 200, height: 30, page: 1 }
})

// 3. User saves the form (this uploads the PDF automatically)
const form = await formManagement.createFormForCurrentDocument(
  'Contact Form',  // title
  pdfFile          // PDF file (optional)
)

// 4. User modifies fields
formFieldsStore.updateField(fieldId, { required: false })

// 5. User updates fields on the server
await formFieldsStore.saveAllFields()

// 6. (Optional) Upload the PDF if not done before
await formManagement.uploadPDFForCurrentForm(pdfFile)
```

## Customization

### Changing the Size Limit

Backend (`backend/src/middleware/upload.ts`):
```typescript
limits: {
  fileSize: 20 * 1024 * 1024 // 20MB
}
```

### Changing the Upload Directory

Backend (`backend/src/middleware/upload.ts`):
```typescript
const uploadsDir = path.join(process.cwd(), 'uploads', 'pdfs')
```

### Adding Additional Validations

Frontend (`frontend/src/services/upload.ts`):
```typescript
// Add custom validation
if (file.name.includes('test')) {
  throw new UploadError(400, 'Test files not allowed')
}
```

## Next Steps

After uploading and saving your form:

1. **Share**: Get the `shareId` to share the form
2. **View responses**: Access the responses dashboard
3. **Publish**: Change the status to "published"
4. **Export**: Download the PDF with completed fields

---

**Need help?** See the [Source of Truth](../sot/README.md) for more details.
