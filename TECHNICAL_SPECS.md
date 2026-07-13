# Technical Specifications - VuePDF Forms Platform

## Table of Contents
1. [System Architecture](#architecture)
2. [PDF Field System](#pdf-fields)
3. [Backend API](#backend-api)
4. [Public Form Viewer](#public-viewer)
5. [Data Models](#backend-api)
6. [Security](#security)
7. [Performance](#performance)

---

## System Architecture <a name="architecture"></a>

### High-Level Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                          USERS                                │
├─────────────────────────────────────────────────────────────┤
│  Creator (Logged In)  │  Respondent (Public)                 │
└───────────┬───────────┴──────────────┬──────────────────────┘
            │                          │
            ▼                          ▼
┌───────────────────────┐    ┌────────────────────────┐
│   FRONTEND - EDITOR   │    │   FRONTEND - VIEWER    │
│   (Vue 3 + TS)        │    │   (Vue 3 + TS)          │
│   /dashboard          │    │ /form/:shareId          │
│   /editor/:id         │    │ (Public)                │
└───────────┬───────────┘    └────────┬───────────────┘
            │                         │
            └─────────┬───────────────┘
                      ▼
            ┌─────────────────────┐
            │   API GATEWAY       │
            │   (REST)            │
            └─────────┬───────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
        ▼             ▼             ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│ Auth     │  │ Forms    │  │ Responses│
│ Service  │  │ Service  │  │ Service  │
└────┬─────┘  └────┬─────┘  └────┬─────┘
     │             │             │
     └─────────────┼─────────────┘
                   ▼
         ┌──────────────────┐
         │   PostgreSQL     │
         │   (Supabase)     │
         └──────────────────┘

         ┌──────────────────┐
         │   Object Storage │
         │   (R2/S3)        │
         │   - PDFs         │
         │   - Assets       │
         └──────────────────┘
```

### Data Flow

#### Flow 1: Create Form
```
User → Editor → Create Form
              → Add Fields (pdf-lib)
              → POST /api/forms
              → Upload PDF to Storage
              → Generate share_id
              → Return form URL
```

#### Flow 2: Respond to Form
```
Respondent → /form/:shareId
           → GET /api/public/forms/:shareId
           → Render PDF + Fields
           → Fill Fields
           → Validate
           → POST /api/forms/:id/responses
           → Save to DB
           → Send notification email
           → Show confirmation
```

#### Flow 3: View Responses
```
Creator → Dashboard
        → GET /api/forms/:id/responses
        → Render table
        → Export CSV/Excel
        → Analytics
```

---

## PDF Field System <a name="pdf-fields"></a>

### Objective
Allow interactive fields to be added to PDFs using pdf-lib so they work in any PDF reader (Adobe, Chrome, etc.).

### Field Types (MVP)

#### 1. Text Field
```typescript
interface TextField {
  id: string              // Unique per form
  type: 'text'
  name: string            // Field name (used by the API)
  label: string           // Visible label
  placeholder?: string
  defaultValue?: string
  required: boolean
  maxLength?: number
  position: {
    page: number         // Page number (1-indexed)
    x: number            // Coordinates in points
    y: number
    width: number
    height: number
  }
  validation?: {
    pattern?: string     // Regex
    errorMessage?: string
  }
  appearance: {
    fontSize: number
    fontColor: string
    backgroundColor?: string
    borderColor?: string
    borderWidth: number
  }
}
```

**Implementation with pdf-lib:**
```typescript
import { PDFDocument, PDFTextField } from 'pdf-lib'

async function addTextField(
  pdfDoc: PDFDocument,
  field: TextField
) {
  const form = pdfDoc.getForm()
  const page = pdfDoc.getPage(field.position.page - 1)

  const textField = form.createTextField(field.name)
  textField.setText(field.defaultValue || '')

  textField.addToPage(page, {
    x: field.position.x,
    y: page.getHeight() - field.position.y - field.position.height,
    width: field.position.width,
    height: field.position.height,
    textColor: hexToRgb(field.appearance.fontColor),
    backgroundColor: field.appearance.backgroundColor
      ? hexToRgb(field.appearance.backgroundColor)
      : undefined,
    borderColor: hexToRgb(field.appearance.borderColor),
    borderWidth: field.appearance.borderWidth,
  })

  if (field.required) {
    textField.setRequired(true)
  }

  if (field.maxLength) {
    textField.setMaxLength(field.maxLength)
  }

  return textField
}
```

#### 2. Checkbox
```typescript
interface CheckboxField {
  id: string
  type: 'checkbox'
  name: string
  label: string
  defaultChecked: boolean
  required: boolean
  position: Position
  appearance: {
    checkColor: string
    borderColor: string
    size: number
  }
}
```

**Implementation:**
```typescript
async function addCheckbox(
  pdfDoc: PDFDocument,
  field: CheckboxField
) {
  const form = pdfDoc.getForm()
  const page = pdfDoc.getPage(field.position.page - 1)

  const checkbox = form.createCheckBox(field.name)

  checkbox.addToPage(page, {
    x: field.position.x,
    y: page.getHeight() - field.position.y - field.appearance.size,
    width: field.appearance.size,
    height: field.appearance.size,
  })

  if (field.defaultChecked) {
    checkbox.check()
  }

  return checkbox
}
```

#### 3. Radio Button Group
```typescript
interface RadioButtonField {
  id: string
  type: 'radio'
  name: string              // Same name = same group
  label: string
  options: Array<{
    value: string
    label: string
    position: Position
  }>
  defaultValue?: string
  required: boolean
  appearance: {
    size: number
    color: string
  }
}
```

**Implementation:**
```typescript
async function addRadioGroup(
  pdfDoc: PDFDocument,
  field: RadioButtonField
) {
  const form = pdfDoc.getForm()
  const radioGroup = form.createRadioGroup(field.name)

  for (const option of field.options) {
    const page = pdfDoc.getPage(option.position.page - 1)

    radioGroup.addOptionToPage(option.value, page, {
      x: option.position.x,
      y: page.getHeight() - option.position.y - field.appearance.size,
      width: field.appearance.size,
      height: field.appearance.size,
    })
  }

  if (field.defaultValue) {
    radioGroup.select(field.defaultValue)
  }

  return radioGroup
}
```

#### 4. Dropdown (Select)
```typescript
interface DropdownField {
  id: string
  type: 'dropdown'
  name: string
  label: string
  options: Array<{
    value: string
    label: string
  }>
  defaultValue?: string
  required: boolean
  position: Position
  appearance: {
    fontSize: number
    fontColor: string
    backgroundColor: string
  }
}
```

**Implementation:**
```typescript
async function addDropdown(
  pdfDoc: PDFDocument,
  field: DropdownField
) {
  const form = pdfDoc.getForm()
  const page = pdfDoc.getPage(field.position.page - 1)

  const dropdown = form.createDropdown(field.name)

  dropdown.addOptions(field.options.map(o => o.value))

  dropdown.addToPage(page, {
    x: field.position.x,
    y: page.getHeight() - field.position.y - field.position.height,
    width: field.position.width,
    height: field.position.height,
  })

  if (field.defaultValue) {
    dropdown.select(field.defaultValue)
  }

  return dropdown
}
```

### Visual Field Editor

```typescript
// composables/useFieldEditor.ts

export function useFieldEditor() {
  const selectedField = ref<FormField | null>(null)
  const fields = ref<FormField[]>([])
  const isAddingField = ref(false)
  const fieldType = ref<'text' | 'checkbox' | 'radio' | 'dropdown'>('text')

  // Add a field when clicking on the PDF
  function handleCanvasClick(event: MouseEvent, pageNumber: number) {
    if (!isAddingField.value) return

    const canvas = event.target as HTMLCanvasElement
    const rect = canvas.getBoundingClientRect()

    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    const field = createField(fieldType.value, {
      page: pageNumber,
      x,
      y,
      width: 200,
      height: 40,
    })

    fields.value.push(field)
    selectedField.value = field
    isAddingField.value = false
  }

  // Drag a field
  function handleFieldDrag(fieldId: string, deltaX: number, deltaY: number) {
    const field = fields.value.find(f => f.id === fieldId)
    if (!field) return

    field.position.x += deltaX
    field.position.y += deltaY
  }

  // Resize a field
  function handleFieldResize(fieldId: string, width: number, height: number) {
    const field = fields.value.find(f => f.id === fieldId)
    if (!field) return

    field.position.width = width
    field.position.height = height
  }

  // Delete a field
  function deleteField(fieldId: string) {
    fields.value = fields.value.filter(f => f.id !== fieldId)
    if (selectedField.value?.id === fieldId) {
      selectedField.value = null
    }
  }

  // Serialize fields for saving
  function serializeFields(): string {
    return JSON.stringify(fields.value)
  }

  return {
    fields,
    selectedField,
    isAddingField,
    fieldType,
    handleCanvasClick,
    handleFieldDrag,
    handleFieldResize,
    deleteField,
    serializeFields,
  }
}
```

### Field Rendering in the Editor

```vue
<!-- components/editor/FieldOverlay.vue -->
<template>
  <div class="field-overlay">
    <div
      v-for="field in fields"
      :key="field.id"
      :class="[
        'field-box',
        { 'selected': selectedField?.id === field.id }
      ]"
      :style="getFieldStyle(field)"
      @mousedown="startDrag(field, $event)"
    >
      <!-- Label -->
      <div class="field-label">{{ field.label }}</div>

      <!-- Resize handles -->
      <div
        v-if="selectedField?.id === field.id"
        class="resize-handle resize-handle-br"
        @mousedown.stop="startResize(field, $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
const { fields, selectedField } = useFieldEditor()

function getFieldStyle(field: FormField) {
  return {
    position: 'absolute',
    left: `${field.position.x}px`,
    top: `${field.position.y}px`,
    width: `${field.position.width}px`,
    height: `${field.position.height}px`,
    border: '2px dashed var(--primary-color)',
    backgroundColor: 'rgba(var(--primary-rgb), 0.1)',
  }
}
</script>
```

### Saving a Form with Fields

```typescript
// stores/form.store.ts

export const useFormStore = defineStore('form', () => {
  const currentForm = ref<Form | null>(null)
  const fields = ref<FormField[]>([])

  async function saveForm() {
    if (!currentForm.value) return

    // 1. Serialize fields into pdf-lib
    const pdfDoc = await PDFDocument.load(currentForm.value.pdfBytes)

    for (const field of fields.value) {
      switch (field.type) {
        case 'text':
          await addTextField(pdfDoc, field as TextField)
          break
        case 'checkbox':
          await addCheckbox(pdfDoc, field as CheckboxField)
          break
        case 'radio':
          await addRadioGroup(pdfDoc, field as RadioButtonField)
          break
        case 'dropdown':
          await addDropdown(pdfDoc, field as DropdownField)
          break
      }
    }

    // 2. Save the modified PDF
    const pdfBytes = await pdfDoc.save()
    const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' })

    // 3. Upload to storage
    const pdfUrl = await uploadPDF(pdfBlob, currentForm.value.id)

    // 4. Save to DB
    const formData = {
      id: currentForm.value.id,
      title: currentForm.value.title,
      description: currentForm.value.description,
      pdf_url: pdfUrl,
      fields: JSON.stringify(fields.value),
      updated_at: new Date().toISOString(),
    }

    await api.put(`/forms/${currentForm.value.id}`, formData)
  }

  async function publishForm() {
    if (!currentForm.value) return

    await saveForm()

    // Generate share_id if it doesn't exist yet
    const response = await api.post(`/forms/${currentForm.value.id}/publish`)

    return {
      shareId: response.data.share_id,
      url: `${window.location.origin}/form/${response.data.share_id}`
    }
  }

  return {
    currentForm,
    fields,
    saveForm,
    publishForm,
  }
})
```

---

## Backend API <a name="backend-api"></a>

### Recommended Stack: Supabase

**Reasons:**
1. PostgreSQL included
2. Auth out-of-the-box (JWT, email, OAuth)
3. Row-level security (RLS)
4. Storage included
5. Realtime subscriptions
6. Auto-generated REST API
7. TypeScript client

### Database Schema

```sql
-- Users (handled by Supabase Auth)
-- We don't need to create this table

-- Forms
CREATE TABLE forms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  pdf_url TEXT NOT NULL,
  fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  share_id TEXT UNIQUE NOT NULL,
  is_published BOOLEAN DEFAULT false,
  settings JSONB DEFAULT '{
    "allow_multiple": true,
    "close_at": null,
    "max_responses": null,
    "require_auth": false,
    "custom_confirmation_message": null
  }'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX forms_user_id_idx ON forms(user_id);
CREATE INDEX forms_share_id_idx ON forms(share_id);
CREATE INDEX forms_created_at_idx ON forms(created_at DESC);

-- Responses
CREATE TABLE responses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  form_id UUID REFERENCES forms(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  respondent_email TEXT,
  respondent_ip TEXT,
  user_agent TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX responses_form_id_idx ON responses(form_id);
CREATE INDEX responses_submitted_at_idx ON responses(submitted_at DESC);
CREATE INDEX responses_email_idx ON responses(respondent_email);

-- Row Level Security (RLS)

-- Forms: users can only see their own forms
ALTER TABLE forms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own forms"
  ON forms FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own forms"
  ON forms FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own forms"
  ON forms FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own forms"
  ON forms FOR DELETE
  USING (auth.uid() = user_id);

-- Responses: users can view responses to their own forms
ALTER TABLE responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view responses to their forms"
  ON responses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM forms
      WHERE forms.id = responses.form_id
      AND forms.user_id = auth.uid()
    )
  );

CREATE POLICY "Anyone can insert responses to published forms"
  ON responses FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM forms
      WHERE forms.id = form_id
      AND forms.is_published = true
    )
  );

-- Functions

-- Function to generate a unique share_id
CREATE OR REPLACE FUNCTION generate_share_id()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Trigger to generate share_id when a form is created
CREATE OR REPLACE FUNCTION set_share_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.share_id IS NULL OR NEW.share_id = '' THEN
    NEW.share_id := generate_share_id();

    -- Ensure uniqueness
    WHILE EXISTS (SELECT 1 FROM forms WHERE share_id = NEW.share_id) LOOP
      NEW.share_id := generate_share_id();
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER forms_share_id_trigger
  BEFORE INSERT ON forms
  FOR EACH ROW
  EXECUTE FUNCTION set_share_id();

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER forms_updated_at_trigger
  BEFORE UPDATE ON forms
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
```

### TypeScript Client (Supabase)

```typescript
// lib/supabase.ts
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Types
export interface Database {
  public: {
    Tables: {
      forms: {
        Row: {
          id: string
          user_id: string
          title: string
          description: string | null
          pdf_url: string
          fields: FormField[]
          share_id: string
          is_published: boolean
          settings: FormSettings
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['forms']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['forms']['Insert']>
      }
      responses: {
        Row: {
          id: string
          form_id: string
          data: Record<string, any>
          respondent_email: string | null
          respondent_ip: string | null
          user_agent: string | null
          submitted_at: string
        }
        Insert: Omit<Database['public']['Tables']['responses']['Row'], 'id' | 'submitted_at'>
        Update: Partial<Database['public']['Tables']['responses']['Insert']>
      }
    }
  }
}
```

### API Service

```typescript
// services/api.service.ts

export const apiService = {
  // Forms
  async createForm(form: CreateFormDto): Promise<Form> {
    const { data, error } = await supabase
      .from('forms')
      .insert({
        title: form.title,
        description: form.description,
        pdf_url: form.pdfUrl,
        fields: form.fields,
        user_id: (await supabase.auth.getUser()).data.user!.id,
      })
      .select()
      .single()

    if (error) throw error
    return data
  },

  async getForms(): Promise<Form[]> {
    const { data, error } = await supabase
      .from('forms')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error
    return data
  },

  async getForm(id: string): Promise<Form> {
    const { data, error } = await supabase
      .from('forms')
      .select('*')
      .eq('id', id)
      .single()

    if (error) throw error
    return data
  },

  async updateForm(id: string, updates: Partial<Form>): Promise<Form> {
    const { data, error } = await supabase
      .from('forms')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data
  },

  async deleteForm(id: string): Promise<void> {
    const { error } = await supabase
      .from('forms')
      .delete()
      .eq('id', id)

    if (error) throw error
  },

  async publishForm(id: string): Promise<{ shareId: string; url: string }> {
    const { data, error } = await supabase
      .from('forms')
      .update({ is_published: true })
      .eq('id', id)
      .select('share_id')
      .single()

    if (error) throw error

    return {
      shareId: data.share_id,
      url: `${window.location.origin}/form/${data.share_id}`
    }
  },

  // Public endpoint (no auth required)
  async getPublicForm(shareId: string): Promise<Form> {
    const { data, error } = await supabase
      .from('forms')
      .select('*')
      .eq('share_id', shareId)
      .eq('is_published', true)
      .single()

    if (error) throw error
    return data
  },

  // Responses
  async submitResponse(formId: string, responseData: Record<string, any>): Promise<void> {
    const { error } = await supabase
      .from('responses')
      .insert({
        form_id: formId,
        data: responseData,
        respondent_ip: await getClientIP(),
        user_agent: navigator.userAgent,
      })

    if (error) throw error
  },

  async getResponses(formId: string): Promise<Response[]> {
    const { data, error } = await supabase
      .from('responses')
      .select('*')
      .eq('form_id', formId)
      .order('submitted_at', { ascending: false })

    if (error) throw error
    return data
  },

  async deleteResponse(id: string): Promise<void> {
    const { error } = await supabase
      .from('responses')
      .delete()
      .eq('id', id)

    if (error) throw error
  },
}
```

---

## Public Form Viewer <a name="public-viewer"></a>

### Main Component

```vue
<!-- pages/FormViewer.vue -->
<template>
  <div class="form-viewer">
    <!-- Header -->
    <div class="form-header">
      <h1>{{ form?.title }}</h1>
      <p>{{ form?.description }}</p>
    </div>

    <!-- PDF with overlaid fields -->
    <div class="pdf-container">
      <canvas ref="pdfCanvas" />

      <!-- Field Overlays -->
      <div class="fields-overlay">
        <component
          v-for="field in fields"
          :key="field.id"
          :is="getFieldComponent(field.type)"
          :field="field"
          :value="formData[field.name]"
          @update="updateField(field.name, $event)"
        />
      </div>
    </div>

    <!-- Submit Button -->
    <div class="form-actions">
      <button
        class="submit-btn"
        :disabled="!isValid || isSubmitting"
        @click="handleSubmit"
      >
        {{ isSubmitting ? 'Submitting...' : 'Submit Response' }}
      </button>
    </div>

    <!-- Validation Errors -->
    <div v-if="errors.length" class="errors">
      <p v-for="error in errors" :key="error">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { apiService } from '@/services/api.service'
import { usePDFRendering } from '@/composables/usePDFRendering'

const route = useRoute()
const router = useRouter()

const shareId = route.params.shareId as string

// State
const form = ref<Form | null>(null)
const fields = ref<FormField[]>([])
const formData = ref<Record<string, any>>({})
const errors = ref<string[]>([])
const isSubmitting = ref(false)

// Load form
onMounted(async () => {
  try {
    form.value = await apiService.getPublicForm(shareId)
    fields.value = form.value.fields

    // Initialize form data
    fields.value.forEach(field => {
      formData.value[field.name] = field.defaultValue || ''
    })

    // Render PDF
    await renderPDF(form.value.pdf_url)
  } catch (error) {
    console.error('Failed to load form:', error)
    // Show error page
  }
})

// Render PDF
const pdfCanvas = ref<HTMLCanvasElement>()
const { renderPage } = usePDFRendering()

async function renderPDF(pdfUrl: string) {
  const loadingTask = pdfjsLib.getDocument(pdfUrl)
  const pdf = await loadingTask.promise
  const page = await pdf.getPage(1)

  await renderPage(page, pdfCanvas.value!)
}

// Update field value
function updateField(name: string, value: any) {
  formData.value[name] = value
  validateField(name)
}

// Validation
const isValid = computed(() => {
  return errors.value.length === 0 && allRequiredFieldsFilled()
})

function validateField(name: string) {
  const field = fields.value.find(f => f.name === name)
  if (!field) return

  errors.value = errors.value.filter(e => !e.includes(field.label))

  // Required validation
  if (field.required && !formData.value[name]) {
    errors.value.push(`${field.label} is required`)
  }

  // Type-specific validation
  if (field.type === 'text' && field.validation?.pattern) {
    const regex = new RegExp(field.validation.pattern)
    if (!regex.test(formData.value[name])) {
      errors.value.push(field.validation.errorMessage || `${field.label} is invalid`)
    }
  }
}

function allRequiredFieldsFilled() {
  return fields.value
    .filter(f => f.required)
    .every(f => formData.value[f.name])
}

// Submit
async function handleSubmit() {
  // Validate all fields
  fields.value.forEach(f => validateField(f.name))

  if (!isValid.value) return

  isSubmitting.value = true

  try {
    await apiService.submitResponse(form.value!.id, formData.value)

    // Redirect to confirmation
    router.push({
      name: 'FormConfirmation',
      params: { shareId },
    })
  } catch (error) {
    console.error('Failed to submit response:', error)
    errors.value.push('Failed to submit. Please try again.')
  } finally {
    isSubmitting.value = false
  }
}

// Get field component
function getFieldComponent(type: string) {
  const components = {
    text: 'TextField',
    checkbox: 'CheckboxField',
    radio: 'RadioField',
    dropdown: 'DropdownField',
  }
  return components[type]
}
</script>
```

### Field Components

```vue
<!-- components/viewer/TextField.vue -->
<template>
  <div
    class="text-field"
    :style="fieldStyle"
  >
    <label v-if="field.label">{{ field.label }}</label>
    <input
      :type="inputType"
      :placeholder="field.placeholder"
      :required="field.required"
      :maxlength="field.maxLength"
      :value="value"
      @input="$emit('update', $event.target.value)"
    />
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  field: TextField
  value: string
}>()

const emit = defineEmits<{
  update: [value: string]
}>()

const inputType = computed(() => {
  if (props.field.validation?.pattern?.includes('email')) return 'email'
  if (props.field.validation?.pattern?.includes('number')) return 'number'
  return 'text'
})

const fieldStyle = computed(() => ({
  position: 'absolute',
  left: `${props.field.position.x}px`,
  top: `${props.field.position.y}px`,
  width: `${props.field.position.width}px`,
  height: `${props.field.position.height}px`,
}))
</script>
```

---

## Security <a name="security"></a>

### Authentication
- JWT tokens (handled by Supabase)
- Automatic refresh tokens
- Session management

### Authorization
- Row-level security (RLS) in PostgreSQL
- Users can only view/edit their own forms
- Users can only view responses to their own forms

### Validation
- Client-side: immediate validation (UX)
- Server-side: mandatory validation (security)
- Rate limiting: 100 requests/min per IP

### Data Privacy
- HTTPS required
- Passwords hashed (bcrypt)
- No logging of sensitive data
- GDPR compliance (right to erasure)

### Upload Security
- Validate file type (PDF only)
- Size limit (10MB per file)
- Virus scanning (future - ClamAV)
- Signed URLs for temporary access

---

## Performance <a name="performance"></a>

### Frontend
- Lazy loading of PDFs
- Virtual scrolling for long lists
- Debounce on search/filters
- Caching of frequently accessed forms (localStorage)
- Code splitting by route
- Image optimization

### Backend
- Database indexes on frequently queried columns
- Connection pooling
- Query optimization
- Caching with Redis (future)
- CDN for PDFs (CloudFlare)

### Targets
- First Contentful Paint (FCP): <1.5s
- Time to Interactive (TTI): <3s
- PDF load time: <2s
- Form submit time: <500ms

---

**Last updated:** 2024-12-27
