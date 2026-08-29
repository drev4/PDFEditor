<template>
  <div
    ref="toolbarRef"
    class="drawing-toolbar"
    :class="{ 'collapsed': isCollapsed, 'dragging': isDragging }"
    :style="{ left: `${position.x}px`, top: `${position.y}px` }"
    @mouseenter="expand"
    @mouseleave="scheduleCollapse"
  >
    <!-- Drag Handle -->
    <div class="toolbar-handle" @mousedown="startDrag" title="Drag to move">
      <i class="pi pi-bars"></i>
    </div>

    <!-- Tool Buttons -->
    <div class="toolbar-tools">
      <button
        v-for="tool in tools"
        :key="tool.id"
        :class="{ 'active': activeTool === tool.id }"
        :title="tool.label"
        @click="selectTool(tool.id)"
      >
        <i :class="tool.icon"></i>
        <span v-show="!isCollapsed">{{ tool.label }}</span>
      </button>
    </div>

    <!-- Separator -->
    <div class="toolbar-separator" v-show="!isCollapsed">
      <span>Fields</span>
    </div>
    <div class="toolbar-separator collapsed-separator" v-show="isCollapsed"></div>

    <!--
      The same field types the editor rail offers, and the same store state
      behind them: `fieldTypeToAdd` is what both read, so arming a type here
      lights it up there and cancelling in either place cancels once.
    -->
    <div class="toolbar-tools field-tools">
      <button
        v-for="tool in fieldTools"
        :key="tool.id"
        :class="{ 'active': formFieldsStore.fieldTypeToAdd === tool.fieldType }"
        :title="tool.label"
        @click="selectFieldTool(tool)"
      >
        <i :class="tool.icon"></i>
        <span v-show="!isCollapsed">{{ tool.label }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { useToolbarDrag } from '@/composables/useToolbarDrag'
import { useFormFieldsStore, type FieldType } from '@/stores/formFields.store'

const formFieldsStore = useFormFieldsStore()

// Tool definitions
const tools = [
  { id: 'search', label: 'Search', icon: 'pi pi-search', group: 'general' },
  { id: 'text', label: 'Text', icon: 'pi pi-pencil', group: 'general' },
  { id: 'image', label: 'Image', icon: 'pi pi-image', group: 'general' }
]

// The same five types as the editor rail, named the same way.
const fieldTools = [
  { id: 'field-text', label: 'Text field', icon: 'pi pi-pencil', fieldType: 'text' as FieldType },
  { id: 'field-textarea', label: 'Paragraph', icon: 'pi pi-align-left', fieldType: 'textarea' as FieldType },
  { id: 'field-checkbox', label: 'Checkbox', icon: 'pi pi-check-square', fieldType: 'checkbox' as FieldType },
  { id: 'field-radio', label: 'Radio group', icon: 'pi pi-circle', fieldType: 'radio' as FieldType },
  { id: 'field-dropdown', label: 'Dropdown', icon: 'pi pi-chevron-down', fieldType: 'dropdown' as FieldType }
]

// State
const toolbarRef = ref<HTMLElement | null>(null)
const isCollapsed = ref(true)
const activeTool = ref<string | null>(null)
const collapseTimeout = ref<number | null>(null)

// Use drag composable
const { position, isDragging, startDrag } = useToolbarDrag(toolbarRef)

// Expand/Collapse behavior
const expand = () => {
  // Clear any pending collapse
  if (collapseTimeout.value) {
    clearTimeout(collapseTimeout.value)
    collapseTimeout.value = null
  }
  isCollapsed.value = false
}

const scheduleCollapse = () => {
  // Collapse after 200ms delay
  collapseTimeout.value = window.setTimeout(() => {
    isCollapsed.value = true
  }, 200)
}

// Emits
const emit = defineEmits<{
  'select-tool': [toolId: string]
}>()

// Clicking an armed type again disarms it, matching the rail.
const selectFieldTool = (tool: { id: string; fieldType: FieldType }) => {
  activeTool.value = tool.id
  if (formFieldsStore.fieldTypeToAdd === tool.fieldType) {
    formFieldsStore.cancelAddingField()
    return
  }
  formFieldsStore.startAddingField(tool.fieldType)
  emit('select-tool', tool.id)
}

// Tool selection
const selectTool = (toolId: string) => {
  activeTool.value = toolId
  formFieldsStore.cancelAddingField()
  emit('select-tool', toolId)
}

// Cleanup
onUnmounted(() => {
  if (collapseTimeout.value) {
    clearTimeout(collapseTimeout.value)
  }
})
</script>

<style scoped>
.drawing-toolbar {
  position: fixed;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(12px);
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  padding: 8px;
  z-index: 15;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  width: 180px;
  user-select: none;
}

.drawing-toolbar.collapsed {
  width: 50px;
}

.drawing-toolbar.dragging {
  transition: none;
  cursor: move;
}

.toolbar-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  cursor: move;
  color: #6a6f7b;
  border-bottom: 1px solid #e7e8ec;
  margin-bottom: 4px;
  transition: all 0.2s ease;
}

.toolbar-handle:hover {
  color: #3554d1;
  background: #f4f5f7;
  border-radius: 6px;
}

.toolbar-tools {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.toolbar-tools button {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  color: #6a6f7b;
  font-size: 14px;
  transition: all 0.2s ease;
  white-space: nowrap;
  overflow: hidden;
  width: 100%;
  text-align: left;
}

.toolbar-tools button:hover {
  background: #f4f5f7;
  color: #3554d1;
}

.toolbar-tools button.active {
  background: #eef1fd;
  color: #3554d1;
  font-weight: 500;
}

.toolbar-tools button i {
  font-size: 16px;
  flex-shrink: 0;
  width: 20px;
  text-align: center;
}

.toolbar-tools button span {
  transition: opacity 0.3s ease;
  flex: 1;
}

.collapsed .toolbar-tools button span {
  opacity: 0;
  width: 0;
}

.toolbar-separator {
  padding: 8px 10px 4px;
  font-size: 11px;
  font-weight: 600;
  color: #9ba1ac;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-top: 1px solid #e7e8ec;
  margin-top: 4px;
}

.collapsed-separator {
  padding: 4px;
  margin: 4px 8px;
  border-top: 1px solid #e7e8ec;
}

.field-tools button.active {
  background: #eef1fd;
  color: #3554d1;
}
</style>
