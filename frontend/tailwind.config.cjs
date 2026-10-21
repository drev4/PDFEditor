/** @type {import('tailwindcss').Config} */

// The DocAIFlow design system, read out of the `System` artboard of the
// design canvas. See docs/sot/05-frontend-patterns.md §8 for where it comes
// from and the three rules it is built on.
//
// `colors` REPLACES Tailwind's default palette rather than extending it — the
// canvas says so, and leaving the stock ramps available is how a screen ends up
// half in `slate-500` and half in `muted`. Consequence to know about: a class
// name that is no longer defined is dropped by Tailwind with no error and no
// build failure. `grep` is the only check.
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      white: '#ffffff',
      black: '#000000',

      // Text, in decreasing weight. Ink is body copy; faint is for column
      // labels and metadata that must not compete with it.
      ink: '#191b21',
      muted: '#6a6f7b',
      faint: '#9ba1ac',
      disabled: '#b9bec7',

      // Rationed. One primary action per screen, the active nav item, the
      // selected field — nothing else.
      accent: {
        DEFAULT: '#3554d1',
        pressed: '#2a45b8',
        soft: '#eef1fd',
      },

      // Status. `published` and `limit` are the two the canvas names; `danger`
      // is the required/closed/destructive red.
      published: { DEFAULT: '#12704f', soft: '#e8f4ee' },
      limit: { DEFAULT: '#8a5c0a', soft: '#fbf2e0' },
      danger: { DEFAULT: '#b02a30', soft: '#f7ecec' },
      neutral: { DEFAULT: '#6a6f7b', soft: '#f2f3f6' },

      // Surfaces. `sunken` is the grey the PDF paper sits on; `subtle` is the
      // sidebar and the hovered/zebra table row.
      surface: {
        DEFAULT: '#ffffff',
        subtle: '#fbfbfc',
        sunken: '#f4f5f7',
        control: '#f4f5f7',
        track: '#eceef2',
      },

      // Borders. `line` is the standard divider, `strong` an input border,
      // `soft` a table rule, `paper` the edge of the rendered PDF page.
      line: {
        DEFAULT: '#e7e8ec',
        strong: '#d8dae1',
        soft: '#f1f2f5',
        paper: '#e2e4e9',
      },

      // Fields on the page. `idle` is an unselected field's border and type
      // tag in the editor; `underline` is the same field on the public form,
      // where it drops to a single rule so the document still reads as a
      // document. `guide` is the editor's alignment guide — the one warm
      // colour in the system, and deliberately not the accent.
      field: {
        idle: '#7a90e2',
        underline: '#cfd3da',
        guide: '#e0642f',
      },
    },

    fontFamily: {
      sans: ['"Instrument Sans"', 'system-ui', '-apple-system', '"Helvetica Neue"', 'Arial', 'sans-serif'],
      mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
    },

    // The canvas type scale, named by role rather than by size, so a screen
    // cannot quietly invent a fourteenth size.
    fontSize: {
      nano: ['9.5px', { lineHeight: '1.2' }],
      tiny: ['10.5px', { lineHeight: '1.3' }],
      label: ['11px', { lineHeight: '1.3', letterSpacing: '0.06em', fontWeight: '600' }],
      micro: ['11.5px', { lineHeight: '1.4' }],
      mono: ['12px', { lineHeight: '1.4' }],
      meta: ['12.5px', { lineHeight: '1.5' }],
      body: ['13px', { lineHeight: '1.5' }],
      row: ['13.5px', { lineHeight: '1.45' }],
      base: ['14px', { lineHeight: '1.5' }],
      brand: ['14.5px', { lineHeight: '1.4', letterSpacing: '-0.01em' }],
      section: ['15px', { lineHeight: '1.4', fontWeight: '600' }],
      title: ['21px', { lineHeight: '1.25', letterSpacing: '-0.015em', fontWeight: '600' }],
      display: ['32px', { lineHeight: '1.15', letterSpacing: '-0.02em', fontWeight: '600' }],
    },

    extend: {
      borderRadius: {
        chip: '3px',
        input: '6px',
        control: '7px',
        card: '10px',
        pill: '999px',
      },
      spacing: {
        gutter: '32px',
        sidebar: '232px',
        rail: '208px',
        panel: '288px',
        // Control heights: 36 primary, 34 secondary, 32 compact, 33 nav row,
        // 56 table row, 48 mobile hit target.
        control: '36px',
        'control-sm': '34px',
        'control-xs': '32px',
        nav: '33px',
        row: '56px',
        touch: '48px',
      },
      boxShadow: {
        // Elevation is for paper and menus only.
        paper: '0 1px 3px rgba(25, 27, 33, 0.06), 0 8px 24px rgba(25, 27, 33, 0.05)',
        menu: '0 6px 18px rgba(25, 27, 33, 0.10)',
        focus: '0 0 0 3px rgba(53, 84, 209, 0.14)',
        'focus-field': '0 0 0 3px rgba(53, 84, 209, 0.13)',
        'focus-danger': '0 0 0 3px rgba(176, 42, 48, 0.12)',
      },
      backgroundColor: {
        'field-fill': 'rgba(53, 84, 209, 0.05)',
        'field-fill-selected': 'rgba(53, 84, 209, 0.08)',
        'field-fill-answered': 'rgba(53, 84, 209, 0.03)',
        'field-fill-invalid': 'rgba(176, 42, 48, 0.04)',
      },
    },
  },
  plugins: [],
}
