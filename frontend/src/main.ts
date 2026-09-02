import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'
import ConfirmationService from 'primevue/confirmationservice'
import Tooltip from 'primevue/tooltip'
import { VuePDFPreset } from './theme'
import router from './router'
import './style.css'
import 'primeicons/primeicons.css'
import App from './App.vue'
import { initErrorTracking, captureAppError } from './services/error-tracking'

const app = createApp(App)
const pinia = createPinia()

pinia.use(piniaPluginPersistedstate)

app.use(pinia)
app.use(router)
app.use(PrimeVue, {
  theme: {
    preset: VuePDFPreset,
    options: {
      darkModeSelector: '.dark-mode',
    }
  }
})
app.use(ToastService)
app.use(ConfirmationService)
app.directive('tooltip', Tooltip)

// Error tracking (features/0034). Installed before mount so an exception
// thrown during the first render is reported; a no-op unless VITE_SENTRY_DSN
// was set at build time, and always off in development.
initErrorTracking(app, router)

/**
 * Vue's own handler catches what throws inside a component — render, lifecycle,
 * watcher, event handler. It does not see a rejected promise nobody awaited,
 * nor an error thrown outside Vue, so the two listeners below cover the rest.
 *
 * Each rethrows nothing and swallows nothing: the console still gets the error,
 * because taking away the developer's own view of a crash to gain a dashboard
 * would be a poor trade.
 */
app.config.errorHandler = (err, _instance, info) => {
  console.error('Vue error:', err, info)
  captureAppError(err, requestIdOf(err))
}

window.addEventListener('unhandledrejection', event => {
  captureAppError(event.reason, requestIdOf(event.reason))
})

window.addEventListener('error', event => {
  captureAppError(event.error ?? event.message)
})

/**
 * Pulls the API's request id off an `ApiError` so the browser event and the
 * server log line carry the same one. Anything else has no id and gets none —
 * this deliberately does not guess.
 */
function requestIdOf(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'requestId' in err) {
    const value = (err as { requestId?: unknown }).requestId
    return typeof value === 'string' ? value : undefined
  }
  return undefined
}

app.mount('#app')
