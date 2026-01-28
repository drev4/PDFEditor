import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import PDFToolbar from './PDFToolbar.vue'

describe('PDFToolbar', () => {
  it('renderiza correctamente con props básicas', () => {
    const wrapper = mount(PDFToolbar, {
      props: {
        currentPage: 1,
        numPages: 10,
        scale: 1.5
      },
      global: {
        stubs: {
          Button: {
            name: 'Button',
            template: '<button><slot /></button>',
            props: ['icon', 'disabled', 'severity']
          }
        }
      }
    })

    expect(wrapper.text()).toContain('1 / 10')
    expect(wrapper.text()).toContain('150%')
  })

  it('emite previous-page al hacer clic en botón anterior', async () => {
    const wrapper = mount(PDFToolbar, {
      props: {
        currentPage: 5,
        numPages: 10,
        scale: 1.5
      },
      global: {
        stubs: {
          Button: {
            name: 'Button',
            template: '<button @click="$emit(\'click\')"><slot /></button>',
            props: ['icon', 'disabled', 'severity']
          }
        }
      }
    })

    const buttons = wrapper.findAllComponents({ name: 'Button' })
    await buttons[0].trigger('click')

    expect(wrapper.emitted('previous-page')).toBeTruthy()
  })

  it('emite next-page al hacer clic en botón siguiente', async () => {
    const wrapper = mount(PDFToolbar, {
      props: {
        currentPage: 5,
        numPages: 10,
        scale: 1.5
      },
      global: {
        stubs: {
          Button: {
            name: 'Button',
            template: '<button @click="$emit(\'click\')"><slot /></button>',
            props: ['icon', 'disabled', 'severity']
          }
        }
      }
    })

    const buttons = wrapper.findAllComponents({ name: 'Button' })
    await buttons[1].trigger('click')

    expect(wrapper.emitted('next-page')).toBeTruthy()
  })

  it('deshabilita botón anterior en primera página', () => {
    const wrapper = mount(PDFToolbar, {
      props: {
        currentPage: 1,
        numPages: 10,
        scale: 1.5
      },
      global: {
        stubs: {
          Button: {
            name: 'Button',
            template: '<button :disabled="disabled"><slot /></button>',
            props: ['icon', 'disabled', 'severity']
          }
        }
      }
    })

    const buttons = wrapper.findAllComponents({ name: 'Button' })
    expect(buttons[0].props('disabled')).toBe(true)
  })

  it('deshabilita botón siguiente en última página', () => {
    const wrapper = mount(PDFToolbar, {
      props: {
        currentPage: 10,
        numPages: 10,
        scale: 1.5
      },
      global: {
        stubs: {
          Button: {
            name: 'Button',
            template: '<button :disabled="disabled"><slot /></button>',
            props: ['icon', 'disabled', 'severity']
          }
        }
      }
    })

    const buttons = wrapper.findAllComponents({ name: 'Button' })
    expect(buttons[1].props('disabled')).toBe(true)
  })

  it('emite zoom-in al hacer clic en zoom in', async () => {
    const wrapper = mount(PDFToolbar, {
      props: {
        currentPage: 1,
        numPages: 10,
        scale: 1.5
      },
      global: {
        stubs: {
          Button: {
            name: 'Button',
            template: '<button @click="$emit(\'click\')"><slot /></button>',
            props: ['icon', 'disabled', 'severity']
          }
        }
      }
    })

    const buttons = wrapper.findAllComponents({ name: 'Button' })
    await buttons[3].trigger('click') // zoom-in button

    expect(wrapper.emitted('zoom-in')).toBeTruthy()
  })

  it('emite zoom-out al hacer clic en zoom out', async () => {
    const wrapper = mount(PDFToolbar, {
      props: {
        currentPage: 1,
        numPages: 10,
        scale: 1.5
      },
      global: {
        stubs: {
          Button: {
            name: 'Button',
            template: '<button @click="$emit(\'click\')"><slot /></button>',
            props: ['icon', 'disabled', 'severity']
          }
        }
      }
    })

    const buttons = wrapper.findAllComponents({ name: 'Button' })
    await buttons[2].trigger('click') // zoom-out button

    expect(wrapper.emitted('zoom-out')).toBeTruthy()
  })

  it('emite rotate al hacer clic en botón rotate', async () => {
    const wrapper = mount(PDFToolbar, {
      props: {
        currentPage: 1,
        numPages: 10,
        scale: 1.5
      },
      global: {
        stubs: {
          Button: {
            name: 'Button',
            template: '<button @click="$emit(\'click\')"><slot /></button>',
            props: ['icon', 'disabled', 'severity', 'label']
          }
        }
      }
    })

    const buttons = wrapper.findAllComponents({ name: 'Button' })
    await buttons[4].trigger('click') // rotate button

    expect(wrapper.emitted('rotate')).toBeTruthy()
  })

  it('muestra escala como porcentaje redondeado', () => {
    const wrapper = mount(PDFToolbar, {
      props: {
        currentPage: 1,
        numPages: 10,
        scale: 1.756
      },
      global: {
        stubs: {
          Button: true
        }
      }
    })

    expect(wrapper.text()).toContain('176%')
  })
})
