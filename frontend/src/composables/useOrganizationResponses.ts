import { ref, computed } from 'vue'
import {
  responsesService,
  type OrganizationResponse
} from '@/services/responses'
import { useAsyncAction } from './useAsyncAction'

/** How many rows a page holds. The server caps anything larger at 100. */
const PAGE_SIZE = 20

/**
 * The organization-wide responses screen
 * ([`features/0024`](../../../features/0024-organization-responses.md)).
 *
 * A composable rather than a store, deliberately: this is one screen's state and
 * nothing else reads it, so it has no reason to outlive the component
 * ([05-frontend-patterns §1](../../../docs/sot/05-frontend-patterns.md)).
 *
 * Paging is the server's, by `limit`/`offset`, matching the per-form listing and
 * `/api/v1` rather than inventing a third convention. It has the known offset
 * flaw — a submission arriving mid-browse shifts the window — which costs a
 * duplicated row on a reading screen and is worth less than a third paging shape
 * inside one product.
 */
export function useOrganizationResponses() {
  const responses = ref<OrganizationResponse[]>([])
  const total = ref(0)
  const offset = ref(0)
  /** `null` is every form; otherwise the one being read. */
  const formId = ref<string | null>(null)

  const loading = ref(false)
  const error = ref<string | null>(null)

  const page = computed(() => Math.floor(offset.value / PAGE_SIZE) + 1)
  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
  const hasPrevious = computed(() => offset.value > 0)
  const hasNext = computed(() => offset.value + PAGE_SIZE < total.value)

  async function load() {
    return useAsyncAction(
      { loading, error },
      async () => {
        const result = await responsesService.listForOrganization({
          limit: PAGE_SIZE,
          offset: offset.value,
          ...(formId.value ? { formId: formId.value } : {})
        })
        responses.value = result.responses
        total.value = result.pagination.total
      },
      { fallbackMessage: 'Could not load the responses' }
    )
  }

  /** Narrowing to a form starts again at the first page, not at page four. */
  async function filterByForm(id: string | null) {
    formId.value = id
    offset.value = 0
    return load()
  }

  async function next() {
    if (!hasNext.value) return
    offset.value += PAGE_SIZE
    return load()
  }

  async function previous() {
    if (!hasPrevious.value) return
    offset.value = Math.max(0, offset.value - PAGE_SIZE)
    return load()
  }

  return {
    responses,
    total,
    formId,
    loading,
    error,
    page,
    pageCount,
    hasPrevious,
    hasNext,
    load,
    filterByForm,
    next,
    previous
  }
}
