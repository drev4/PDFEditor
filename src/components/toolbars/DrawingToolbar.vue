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
  </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { useToolbarDrag } from '@/composables/useToolbarDrag'

// Tool definitions
const tools = [
  { id: 'search', label: 'Buscar', icon: 'pi pi-search' },
  { id: 'text', label: 'Texto', icon: 'pi pi-pencil' },
  { id: 'image', label: 'Imagen', icon: 'pi pi-image' }
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

// Tool selection
const selectTool = (toolId: string) => {
  activeTool.value = toolId
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
  color: #6b7280;
  border-bottom: 1px solid #e5e7eb;
  margin-bottom: 4px;
  transition: all 0.2s ease;
}

.toolbar-handle:hover {
  color: #3b82f6;
  background: #f3f4f6;
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
  color: #4b5563;
  font-size: 14px;
  transition: all 0.2s ease;
  white-space: nowrap;
  overflow: hidden;
  width: 100%;
  text-align: left;
}

.toolbar-tools button:hover {
  background: #f3f4f6;
  color: #3b82f6;
}

.toolbar-tools button.active {
  background: #dbeafe;
  color: #2563eb;
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
</style>
