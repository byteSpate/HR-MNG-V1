import { env } from "./config/env"
import app from "./app"
import { startJobs } from "./jobs"
import { mailMode } from "./utils/mailer"

app.listen(env.PORT, () => {
  console.log(`Server listening on port ${env.PORT}`)
  // Which of the two mail modes is live. The dispatch log looks the same
  // either way, so without this line "why has nobody received anything" is
  // answered by reading source rather than by reading a log.
  console.log(mailMode())
})

// Only in the long-lived server process. A scheduler started during a test
// run or a one-off script leaks a timer handle and hangs the process.
if (process.env.NODE_ENV !== "test") {
  startJobs()
}
