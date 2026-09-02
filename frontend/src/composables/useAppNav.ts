import { useRoute } from 'vue-router'

export interface NavItem {
  to: string
  label: string
  icon: string
  match: string
}

/**
 * The application's destinations, in the order the design canvas draws them.
 *
 * Shared because there are two places that show them — the sidebar on the
 * dashboard screens, and the drawer behind the editor's menu button — and a
 * navigation that disagrees with itself depending on where you opened it is
 * worse than one that is merely incomplete.
 *
 * `Responses` and `Settings` lead to screens that say what is not built rather
 * than to nothing; see NotBuiltYet.vue.
 */
export const navItems: NavItem[] = [
  { to: '/dashboard', label: 'Forms', icon: 'pi pi-file', match: '/dashboard' },
  { to: '/dashboard/responses', label: 'Responses', icon: 'pi pi-inbox', match: '/dashboard/responses' },
  { to: '/dashboard/team', label: 'Members', icon: 'pi pi-users', match: '/dashboard/team' },
  { to: '/dashboard/settings', label: 'Settings', icon: 'pi pi-cog', match: '/dashboard/settings' },
]

export function useAppNav() {
  const route = useRoute()

  // `Forms` owns both /dashboard and /dashboard/forms, and must not also light
  // up for every other screen underneath /dashboard.
  const isActive = (item: NavItem) =>
    item.match === '/dashboard'
      ? route.path === '/dashboard' || route.path.startsWith('/dashboard/forms')
      : route.path.startsWith(item.match)

  return { navItems, isActive }
}
