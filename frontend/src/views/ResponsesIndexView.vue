<template>
  <AppShell>
    <div class="flex flex-col flex-grow min-h-0 overflow-y-auto">
      <header class="flex items-end gap-4 px-gutter pt-[26px] pb-5">
        <div class="flex-grow min-w-0">
          <h1 class="text-title">Responses</h1>
          <p class="mt-0.5 text-body text-muted">
            Everything collected across this organization's forms, newest first.
          </p>
        </div>

        <!--
          Filtering by form is one indexed `where`. Searching *inside* answers is
          not offered and is not an oversight: it would mean reading the answer
          values this screen deliberately never receives.
        -->
        <select
          v-if="formsStore.forms.length"
          :value="formId ?? ''"
          class="h-control-sm px-2.5 rounded-input border border-line-strong bg-surface text-body focus:outline-none focus:border-accent focus:shadow-focus"
          data-testid="responses-form-filter"
          @change="onFilterChange"
        >
          <option value="">All forms</option>
          <option v-for="form in formsStore.forms" :key="form.id" :value="form.id">
            {{ form.title }}
          </option>
        </select>
      </header>

      <p
        v-if="error"
        class="mx-gutter mb-5 px-4 py-3 rounded-card border border-danger bg-danger-soft text-body text-danger"
        role="alert"
        data-testid="responses-error"
      >
        {{ error }}
      </p>

      <section v-if="rows.length" class="flex-grow">
        <table class="w-full" data-testid="organization-responses-table">
          <thead>
            <tr class="border-b border-line-soft">
              <th class="col-label text-left px-gutter py-2.5">Form</th>
              <th class="col-label text-left py-2.5 w-[132px]">Answers</th>
              <th class="col-label text-left py-2.5 w-[180px]">Submitted</th>
              <th class="py-2.5 w-[120px] pr-gutter" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="response in rows"
              :key="response.id"
              :data-testid="`response-${response.id}`"
              class="border-b border-line-soft hover:bg-surface-subtle transition-colors"
            >
              <td class="px-gutter py-3">
                <div class="text-row font-medium truncate">{{ response.formTitle }}</div>
              </td>
              <td class="py-3">
                <span class="num text-meta text-muted">{{ response.answerCount }}</span>
              </td>
              <td class="py-3">
                <span class="num text-mono text-muted">{{ submittedAt(response.submittedAt) }}</span>
              </td>
              <td class="py-3 pr-gutter text-right">
                <!--
                  The answers live here, on the form's own screen, which is the
                  one with the columns to render them in.
                -->
                <RouterLink
                  :to="`/dashboard/forms/${response.formId}/responses`"
                  class="text-meta text-muted hover:text-ink transition-colors"
                  :data-testid="`open-form-${response.id}`"
                >
                  Open form
                </RouterLink>
              </td>
            </tr>
          </tbody>
        </table>

        <!--
          The total is of what is listed. It is **not** the plan meter, which
          counts submissions accepted in a period and does not refund a deleted
          form — they disagree honestly, so this never sits beside a meter.
        -->
        <div class="flex items-center gap-4 px-gutter py-4">
          <span class="text-meta text-faint">
            <span class="num">{{ total }}</span>
            {{ total === 1 ? 'response' : 'responses' }}
            <template v-if="pageCount > 1">
              · page <span class="num">{{ page }}</span> of
              <span class="num">{{ pageCount }}</span>
            </template>
          </span>
          <div class="flex-grow" />
          <button
            type="button"
            class="h-control-xs px-2.5 rounded-input text-meta text-muted hover:text-ink hover:bg-surface-sunken disabled:text-disabled disabled:hover:bg-transparent transition-colors"
            :disabled="!hasPrevious"
            data-testid="responses-previous"
            @click="previous()"
          >
            Previous
          </button>
          <button
            type="button"
            class="h-control-xs px-2.5 rounded-input text-meta text-muted hover:text-ink hover:bg-surface-sunken disabled:text-disabled disabled:hover:bg-transparent transition-colors"
            :disabled="!hasNext"
            data-testid="responses-next"
            @click="next()"
          >
            Next
          </button>
        </div>
      </section>

      <!--
        Nothing collected yet. An empty table would say "your data is missing"
        rather than "there is none", which is a different and false claim
        (05-frontend-patterns §8).
      -->
      <section
        v-else-if="!loading"
        class="px-gutter py-8"
        data-testid="responses-empty"
      >
        <p class="text-body text-muted max-w-[520px]">
          <template v-if="formId">
            Nothing has been submitted to this form yet.
          </template>
          <template v-else>
            Nothing has been submitted yet. Publish a form and share its link, and
            every response will appear here.
          </template>
        </p>
        <RouterLink
          to="/dashboard"
          class="inline-block mt-3 text-meta text-accent hover:text-accent-pressed"
          data-testid="responses-empty-forms-link"
        >
          Go to Forms
        </RouterLink>
      </section>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import AppShell from '@/layouts/AppShell.vue'
import { useOrganizationResponses } from '@/composables/useOrganizationResponses'
import { useFormsStore } from '@/stores/forms.store'
import { submittedAt } from '@/utils/formatDate'

/**
 * The `Responses` destination
 * ([`features/0024`](../../../features/0024-organization-responses.md)).
 *
 * It used to say it was not built, because the API only listed per form. What it
 * shows now is deliberately narrow — which form, when, how many answers — and
 * the answers themselves stay on the form's own screen: this is a browsing
 * surface over everything the organization has collected, and it carries no
 * respondent data at all.
 *
 * There is **no CSV control here** and there should not be. Two forms share no
 * fields, so a combined export is either one column per field in the
 * organization or a generic file that answers nothing; the per-form export is
 * reachable from each form, which is where the columns exist.
 */
const {
  responses: rows,
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
} = useOrganizationResponses()

// The filter names forms, and the forms list is already a store every screen
// shares.
const formsStore = useFormsStore()

onMounted(() => {
  load()
  if (!formsStore.forms.length) formsStore.fetchForms().catch(() => {})
})

function onFilterChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  filterByForm(value || null)
}
</script>
