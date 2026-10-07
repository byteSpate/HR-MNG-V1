import { AppError } from "../middleware/errorHandler"

interface Waiter {
  resolve: () => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * At most `max` tasks run at the same time. The others wait in line, in the
 * order they came. A task that waits longer than `maxWaitMs` is refused with a
 * message the user can act on.
 *
 * A place is handed straight to the next waiter when a task ends, so it can
 * never be taken by a newcomer in between. A task that throws still frees its
 * place.
 */
export function createLimiter(max: number, maxWaitMs: number) {
  let active = 0
  const queue: Waiter[] = []

  function release() {
    const next = queue.shift()
    if (next) {
      clearTimeout(next.timer)
      next.resolve() // the place passes on, so `active` stays the same
    } else {
      active -= 1
    }
  }

  function waitForPlace(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        timer: setTimeout(() => {
          const index = queue.indexOf(waiter)
          if (index !== -1) queue.splice(index, 1)
          reject(new AppError(503, "Many PDF files are being made right now. Please wait a minute and try again."))
        }, maxWaitMs),
      }
      queue.push(waiter)
    })
  }

  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (active < max) {
      active += 1
    } else {
      await waitForPlace()
    }
    try {
      return await task()
    } finally {
      release()
    }
  }
}
