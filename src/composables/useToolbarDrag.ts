import { ref, onMounted, onUnmounted, type Ref } from 'vue'

export function useToolbarDrag(toolbarRef: Ref<HTMLElement | null>) {
  const position = ref({ x: 80, y: 150 })
  const isDragging = ref(false)
  const dragOffset = ref({ x: 0, y: 0 })

  const startDrag = (e: MouseEvent) => {
    e.preventDefault()
    isDragging.value = true

    const rect = toolbarRef.value?.getBoundingClientRect()
    if (rect) {
      dragOffset.value = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      }
    }
  }

  const onDrag = (e: MouseEvent) => {
    if (!isDragging.value || !toolbarRef.value) return

    const toolbarWidth = toolbarRef.value.offsetWidth
    const toolbarHeight = toolbarRef.value.offsetHeight

    // Calculate new position
    let newX = e.clientX - dragOffset.value.x
    let newY = e.clientY - dragOffset.value.y

    // Apply bounds constraints (20px margin from edges)
    const minX = 20
    const minY = 20
    const maxX = window.innerWidth - toolbarWidth - 20
    const maxY = window.innerHeight - toolbarHeight - 20

    newX = Math.max(minX, Math.min(maxX, newX))
    newY = Math.max(minY, Math.min(maxY, newY))

    position.value = { x: newX, y: newY }
  }

  const stopDrag = () => {
    isDragging.value = false
  }

  onMounted(() => {
    document.addEventListener('mousemove', onDrag)
    document.addEventListener('mouseup', stopDrag)
  })

  onUnmounted(() => {
    document.removeEventListener('mousemove', onDrag)
    document.removeEventListener('mouseup', stopDrag)
  })

  return {
    position,
    isDragging,
    startDrag
  }
}
