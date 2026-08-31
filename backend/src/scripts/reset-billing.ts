import { PrismaClient } from '@prisma/client'
import Stripe from 'stripe'
import { DEFAULT_PLAN_KEY } from '../services/plans.js'

/**
 * Devuelve una organización al plan free para poder volver a probar la compra.
 * **Solo desarrollo y test.** Nunca es parte del producto.
 *
 * Existe porque una suscripción cancelada en el portal se queda viva hasta el
 * final del periodo — que es el comportamiento correcto y deseado
 * (features/0013, trampa 6: el cliente ya pagó ese mes) — y eso hace imposible
 * repetir el flujo de alta el mismo día. Este script corta ese nudo sin tocar
 * la regla de negocio.
 *
 * ## Lo que NO hace, y es lo importante
 *
 * **No borra ni un solo dato de cliente.** No toca `forms`, `fields`,
 * `responses` ni `answers`, y lo comprueba: cuenta esas cuatro tablas antes y
 * después y aborta si alguna cambió. Un script de pruebas que despublica
 * formularios o borra respuestas es exactamente el fallo del que este
 * repositorio tiene una regla escrita (CLAUDE.md, regla 5).
 *
 * **No escribe `Organization.planKey` salvo que se lo pidas.** Por defecto
 * cancela en Stripe y espera a que el webhook haga la reconciliación, que es lo
 * que mantiene intacta la invariante de que `reconcileSubscription` es el único
 * escritor de esa columna (docs/sot/03-domain-model.md) — y de paso comprueba
 * que el webhook funciona de verdad. Solo con `--force-local` escribe el estado
 * a mano, y entonces lo dice en voz alta.
 *
 * ## Uso
 *
 *   npm run billing:reset -- --email=tu@correo.com --dry-run
 *   npm run billing:reset -- --email=tu@correo.com
 *   npm run billing:reset -- --email=tu@correo.com --delete-customer
 *
 * Flags:
 *   --email=<correo>     La organización del usuario con ese correo
 *   --org=<uuid>         La organización por id (alternativa a --email)
 *   --dry-run            Enseña lo que haría y no hace nada
 *   --delete-customer    Borra también el cliente en Stripe, para que la
 *                        siguiente compra cree uno nuevo y se ejercite ese
 *                        camino. Por defecto se conserva, que es lo que evita
 *                        un segundo cliente para una misma organización.
 *   --keep-events        Conserva las filas de `stripe_events`. Por defecto se
 *                        borran, porque si no `stripe events resend` de un
 *                        evento antiguo se ignora como duplicado y parece que
 *                        el webhook está roto.
 *   --force-local        No espera al webhook: escribe el estado local
 *                        directamente. Para cuando `stripe listen` no está
 *                        corriendo o algo se quedó a medias.
 *   --wait=<segundos>    Cuánto esperar al webhook (por defecto 20)
 */

const prisma = new PrismaClient()

/**
 * Entornos en los que este script puede ejecutarse.
 *
 * Lista de permitidos, no de prohibidos, por la misma razón que
 * `OVERRIDE_ENVIRONMENTS` en `services/plans.ts`: la versión obvia
 * (`NODE_ENV !== 'production'`) se ejecuta alegremente cuando `NODE_ENV` está
 * sin definir, mal escrito o lo perdió un gestor de procesos. Aquí el modo de
 * fallo de un `NODE_ENV` ausente es que el script se niega a hacer nada.
 */
const ALLOWED_ENVIRONMENTS = ['development', 'test']

interface Options {
  email?: string
  orgId?: string
  dryRun: boolean
  deleteCustomer: boolean
  keepEvents: boolean
  forceLocal: boolean
  waitSeconds: number
}

function parseArgs(argv: string[]): Options {
  const get = (name: string) =>
    argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')

  return {
    email: get('email'),
    orgId: get('org'),
    dryRun: argv.includes('--dry-run'),
    deleteCustomer: argv.includes('--delete-customer'),
    keepEvents: argv.includes('--keep-events'),
    forceLocal: argv.includes('--force-local'),
    waitSeconds: Number(get('wait') ?? 20)
  }
}

/**
 * Se niega a arrancar salvo en desarrollo y con una clave de test.
 *
 * Las dos comprobaciones son independientes a propósito: un `NODE_ENV` de
 * desarrollo con una `sk_live_` apuntando a la cuenta real es precisamente el
 * accidente que cancela la suscripción de un cliente que paga.
 */
function assertSafeToRun(): string {
  const environment = process.env.NODE_ENV?.trim() ?? ''

  if (!ALLOWED_ENVIRONMENTS.includes(environment)) {
    throw new Error(
      `Este script solo se ejecuta con NODE_ENV en [${ALLOWED_ENVIRONMENTS.join(', ')}]. ` +
      `Ahora vale ${environment ? `"${environment}"` : '(sin definir)'}.`
    )
  }

  const key = process.env.STRIPE_SECRET_KEY?.trim()

  if (!key) {
    throw new Error('Falta STRIPE_SECRET_KEY.')
  }

  if (!key.startsWith('sk_test_')) {
    throw new Error(
      'STRIPE_SECRET_KEY no es una clave de test (sk_test_...). Este script cancela ' +
      'suscripciones: contra una cuenta real le quitaría el plan a un cliente que paga.'
    )
  }

  return key
}

/** Las cuatro tablas que este script no puede tocar. */
async function countCustomerData() {
  const [forms, published, fields, responses, answers] = await Promise.all([
    prisma.form.count(),
    prisma.form.count({ where: { status: 'published' } }),
    prisma.field.count(),
    prisma.response.count(),
    prisma.answer.count()
  ])
  return { forms, published, fields, responses, answers }
}

async function resolveOrganizationId(options: Options): Promise<string> {
  if (options.orgId) return options.orgId

  if (!options.email) {
    throw new Error('Hace falta --email=<correo> o --org=<uuid>.')
  }

  const membership = await prisma.membership.findFirst({
    where: { user: { email: options.email.toLowerCase().trim() } },
    orderBy: { createdAt: 'asc' },
    select: { organizationId: true }
  })

  if (!membership) {
    throw new Error(`Ningún usuario con correo "${options.email}" pertenece a una organización.`)
  }

  return membership.organizationId
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Espera a que el webhook deje la organización en free. */
async function waitForWebhook(organizationId: string, seconds: number): Promise<boolean> {
  const deadline = Date.now() + seconds * 1000

  while (Date.now() < deadline) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { planKey: true }
    })

    if (organization?.planKey === DEFAULT_PLAN_KEY) return true
    await sleep(1000)
  }

  return false
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const secretKey = assertSafeToRun()
  const stripe = new Stripe(secretKey)

  console.log(`\n🧹 Reset de billing — ${options.dryRun ? '🔍 DRY RUN' : '✍️  EN SERIO'}\n`)

  const organizationId = await resolveOrganizationId(options)
  const before = await countCustomerData()

  const [organization, subscription] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, planKey: true }
    }),
    prisma.subscription.findUnique({ where: { organizationId } })
  ])

  if (!organization) throw new Error(`No existe la organización ${organizationId}.`)

  const events = await prisma.stripeEvent.count()

  console.log(`Organización : ${organization.name} (${organization.id})`)
  console.log(`Plan actual  : ${organization.planKey}`)
  console.log(`Suscripción  : ${subscription?.stripeSubscriptionId ?? '(ninguna)'} — ${subscription?.status ?? '—'}`)
  console.log(`Cliente      : ${subscription?.stripeCustomerId ?? '(ninguno)'}`)
  console.log(`Eventos      : ${events}`)
  console.log(`Datos intactos que NO se tocan: ${before.forms} formularios (${before.published} publicados), ` +
    `${before.responses} respuestas, ${before.answers} valores\n`)

  if (options.dryRun) {
    console.log('Haría:')
    if (subscription?.stripeSubscriptionId) {
      console.log(`  • Cancelar ${subscription.stripeSubscriptionId} en Stripe, YA (no a fin de periodo)`)
    }
    if (options.deleteCustomer && subscription?.stripeCustomerId) {
      console.log(`  • Borrar el cliente ${subscription.stripeCustomerId} en Stripe`)
    }
    console.log(`  • ${options.forceLocal ? 'Escribir' : 'Esperar al webhook para'} planKey="${DEFAULT_PLAN_KEY}"`)
    console.log('  • Borrar la fila local de subscriptions')
    if (!options.keepEvents) console.log(`  • Borrar ${events} filas de stripe_events`)
    console.log('\nNada modificado.\n')
    return
  }

  // 1. Cancelar en Stripe, inmediatamente. `cancel_at_period_end` es lo correcto
  //    para un cliente real y es justo lo que impide repetir la prueba hoy.
  if (subscription?.stripeSubscriptionId) {
    try {
      const cancelled = await stripe.subscriptions.cancel(subscription.stripeSubscriptionId)
      console.log(`✅ Stripe: ${cancelled.id} → ${cancelled.status}`)
    } catch (error) {
      // Ya cancelada o inexistente no es un fallo: el objetivo es el estado
      // final, no haber sido quien lo provocó.
      console.log(`⚠️  Stripe: no se pudo cancelar (${(error as Error).message}). Sigo.`)
    }
  }

  if (options.deleteCustomer && subscription?.stripeCustomerId) {
    try {
      await stripe.customers.del(subscription.stripeCustomerId)
      console.log(`✅ Stripe: cliente ${subscription.stripeCustomerId} borrado`)
    } catch (error) {
      console.log(`⚠️  Stripe: no se pudo borrar el cliente (${(error as Error).message}).`)
    }
  }

  // 2. Dejar que el webhook reconcilie. Es el camino de producción, mantiene
  //    intacta la invariante del escritor único y de paso comprueba que
  //    `stripe listen` está levantado.
  let reconciled = false

  if (subscription?.stripeSubscriptionId && !options.forceLocal) {
    process.stdout.write(`⏳ Esperando al webhook (${options.waitSeconds}s)… `)
    reconciled = await waitForWebhook(organizationId, options.waitSeconds)
    console.log(reconciled ? 'llegó ✅' : 'no llegó ⚠️')

    if (!reconciled) {
      console.log(
        '   El webhook no reconcilió. Casi siempre significa que `stripe listen` no\n' +
        '   está corriendo — y entonces el plan tampoco se movería en una compra real.\n' +
        '   Arráncalo, o repite con --force-local para escribir el estado a mano.'
      )
    }
  }

  // 3. Limpiar lo que quede. Solo tablas de billing.
  const [, deletedEvents] = await prisma.$transaction([
    prisma.subscription.deleteMany({ where: { organizationId } }),
    options.keepEvents
      ? prisma.stripeEvent.findMany({ take: 0 })
      : prisma.stripeEvent.deleteMany({})
  ])

  console.log('✅ Local: fila de subscriptions borrada')
  if (!options.keepEvents) {
    console.log(`✅ Local: ${(deletedEvents as { count?: number }).count ?? 0} filas de stripe_events borradas`)
  }

  if (options.forceLocal || !reconciled) {
    // El único sitio del repositorio, aparte de `reconcileSubscription`, que
    // escribe esta columna — y por eso lo anuncia.
    await prisma.organization.update({
      where: { id: organizationId },
      data: { planKey: DEFAULT_PLAN_KEY }
    })
    console.log(`⚠️  Local: planKey escrito a mano ("${DEFAULT_PLAN_KEY}"), sin pasar por el webhook`)
  }

  // 4. Comprobar que no se ha destruido nada. Esta es la parte que justifica
  //    que el script exista en el repositorio y no en el historial de alguien.
  const after = await countCustomerData()
  const untouched =
    before.forms === after.forms &&
    before.published === after.published &&
    before.fields === after.fields &&
    before.responses === after.responses &&
    before.answers === after.answers

  if (!untouched) {
    console.error('\n❌ DATOS DE CLIENTE MODIFICADOS. Esto es un fallo del script.')
    console.error('   antes:', before)
    console.error('   ahora:', after)
    process.exitCode = 1
    return
  }

  const organizationAfter = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { planKey: true }
  })

  console.log(`\n✅ Datos de cliente intactos: ${after.forms} formularios (${after.published} publicados), ` +
    `${after.responses} respuestas, ${after.answers} valores`)
  console.log(`✅ Plan: ${organizationAfter?.planKey}\n`)
  console.log('Ya puedes volver a comprar Pro desde Ajustes.\n')
}

main()
  .catch(error => {
    console.error(`\n❌ ${(error as Error).message}\n`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
