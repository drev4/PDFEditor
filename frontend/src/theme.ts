import { definePreset } from '@primevue/themes'
import Aura from '@primevue/themes/aura'

/**
 * The DocAIFlow preset.
 *
 * The design canvas is explicit that this is a token change, not a component
 * migration: *"Tailwind's default palette is replaced; PrimeVue Aura keeps the
 * component behaviour."* So Aura stays, and only its semantic tokens move.
 *
 * This file exists because the alternative does not work. Nine of the ten views
 * are built out of PrimeVue components, and those read their colours from the
 * preset, not from Tailwind classes. Styling only the hand-written markup would
 * leave Aura's own emerald primary on every Button and DataTable sitting next
 * to the canvas accent on the same screen.
 *
 * Values are from the `System` artboard; see docs/sot/05-frontend-patterns.md §8.
 */

// A ramp built around the canvas accent (#3554d1) and its pressed state
// (#2a45b8). Only 500 and 600 are design values — the rest are interpolated to
// give Aura the ten steps it expects for hovers, focus rings and subtle fills.
const accentRamp = {
  50: '#eef1fd',
  100: '#dde3fb',
  200: '#bcc8f6',
  300: '#9aacf0',
  400: '#6b87e4',
  500: '#3554d1',
  600: '#2a45b8',
  700: '#233a99',
  800: '#1c2e79',
  900: '#152258',
  950: '#0e173c',
}

// Our neutrals, mapped onto Aura's surface scale. 0 is paper, 50 the sidebar
// and zebra rows, 300 the standard divider (`line`), 400 an input border
// (`line.strong`), 700 muted text and 900 ink.
const surfaceRamp = {
  0: '#ffffff',
  50: '#fbfbfc',
  100: '#f4f5f7',
  200: '#eceef2',
  300: '#e7e8ec',
  400: '#d8dae1',
  500: '#b9bec7',
  600: '#9ba1ac',
  700: '#6a6f7b',
  800: '#43474f',
  900: '#191b21',
  950: '#101218',
}

export const VuePDFPreset = definePreset(Aura, {
  primitive: {
    borderRadius: {
      none: '0',
      xs: '3px',
      sm: '6px',
      md: '7px',
      lg: '10px',
      xl: '12px',
    },
  },
  semantic: {
    primary: accentRamp,
    // 3px at 14% opacity — the focused-input ring drawn in the System artboard.
    focusRing: {
      width: '3px',
      style: 'solid',
      color: 'rgba(53, 84, 209, 0.14)',
      offset: '0',
      shadow: 'none',
    },
    formField: {
      borderRadius: '6px',
      focusRing: {
        width: '3px',
        style: 'solid',
        color: 'rgba(53, 84, 209, 0.14)',
        offset: '0',
        shadow: 'none',
      },
    },
    content: {
      borderRadius: '10px',
    },
    overlay: {
      select: { borderRadius: '7px' },
      popover: { borderRadius: '10px' },
      modal: { borderRadius: '10px' },
    },
    colorScheme: {
      light: {
        primary: {
          color: '#3554d1',
          contrastColor: '#ffffff',
          hoverColor: '#2a45b8',
          activeColor: '#2a45b8',
        },
        highlight: {
          background: '#eef1fd',
          focusBackground: '#eef1fd',
          color: '#2a45b8',
          focusColor: '#2a45b8',
        },
        surface: surfaceRamp,
        text: {
          color: '#191b21',
          hoverColor: '#191b21',
          mutedColor: '#6a6f7b',
          hoverMutedColor: '#191b21',
        },
        content: {
          background: '#ffffff',
          hoverBackground: '#f4f5f7',
          borderColor: '#e7e8ec',
          color: '#191b21',
          hoverColor: '#191b21',
        },
        formField: {
          background: '#ffffff',
          disabledBackground: '#f4f5f7',
          filledBackground: '#f4f5f7',
          borderColor: '#d8dae1',
          hoverBorderColor: '#9ba1ac',
          focusBorderColor: '#3554d1',
          invalidBorderColor: '#b02a30',
          color: '#191b21',
          disabledColor: '#b9bec7',
          placeholderColor: '#9ba1ac',
          invalidPlaceholderColor: '#c68a8d',
          floatLabelColor: '#6a6f7b',
        },
      },
    },
  },
})
