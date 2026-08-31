/**
 * Serialises work that must not run twice for the same organization at once
 * (features/0014).
 *
 * Built for exactly one caller: `POST /api/billing/checkout`, where reading the
 * stored Stripe customer and writing it back are two steps, and a double click
 * — or two tabs, or a direct API caller — can put both requests between them.
 *
 * ## Why this and not a database lock
 *
 * The obvious shape is `SELECT … FOR UPDATE` on the subscription row. It does
 * not work here, and the reason is worth writing down because the code would
 * look correct: **on the first checkout there is no row to lock.** That is
 * precisely the case the race matters in, and a `FOR UPDATE` against a row that
 * does not exist locks nothing and blocks nobody.
 *
 * The next shape is a transaction-scoped advisory lock
 * (`pg_advisory_xact_lock`), which does work for an absent row — but it is held
 * only until the transaction commits, so covering the Stripe call means keeping
 * a Postgres transaction open across a network round trip. That ties a pooled
 * connection to Stripe's latency and turns a Stripe timeout into a stuck
 * transaction. Trading a rare double-billing for a routine connection leak is a
 * bad trade.
 *
 * ## What this actually covers, and what it does not
 *
 * This is an **in-process** lock, so it serialises concurrent requests handled
 * by the same Node process. That is the entire realistic threat: a double
 * click, or a component firing twice, arrives on one connection to one replica.
 *
 * It does **not** serialise across replicas, and it is not pretending to. Two
 * requests landing on two processes at the same instant are covered by a
 * different mechanism — the Stripe idempotency key on `customers.create`, keyed
 * on the organization, which makes Stripe replay the first response rather than
 * mint a second customer. The two are layers, not alternatives: the lock stops
 * this application from asking twice, the key stops Stripe from answering twice
 * differently.
 *
 * If this ever needs to be genuinely distributed, the answer is the Redis that
 * step 9 of the build order brings, not a bigger lock here.
 */

/**
 * The tail of the queue for each organization, or nothing when it is idle.
 *
 * A promise chain rather than a counter: each caller waits on the previous
 * one's settlement and installs itself as the new tail. Entries are deleted
 * when the last waiter finishes, so this cannot grow with the number of
 * organizations the process has ever seen.
 */
const queues = new Map<string, Promise<unknown>>()

/**
 * Runs `work` with nothing else running under the same key in this process.
 *
 * Rejections propagate to the caller and do **not** poison the queue: the chain
 * continues from a settled promise either way, so one failed checkout cannot
 * wedge every later one for that organization.
 */
export async function withOrganizationLock<T>(
  key: string,
  work: () => Promise<T>
): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()

  // `work` runs whether the previous holder resolved or rejected — one failed
  // checkout must not wedge every later one for that organization.
  const run = previous.then(work, work)

  // The tail never rejects, so nobody chained behind it sees an unhandled
  // rejection from someone else's failure.
  const guard = run.then(
    () => undefined,
    () => undefined
  )
  queues.set(key, guard)

  try {
    return await run
  } finally {
    // Delete only if nobody queued behind us. Otherwise a later caller is still
    // chained onto `guard`, and dropping it would let two run at once.
    if (queues.get(key) === guard) queues.delete(key)
  }
}

/** Only for tests: forget every queue. */
export function resetOrganizationLocks(): void {
  queues.clear()
}
