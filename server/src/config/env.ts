import "dotenv/config"
import { z } from "zod"

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(4000),
  CLIENT_ORIGIN: z.string().default("http://localhost:3000"),
  // Optional comma-separated CORS allowlist. Defaults to [CLIENT_ORIGIN].
  // Separate from CLIENT_ORIGIN because that one is also the base for
  // outbound email links, where a list would corrupt every URL.
  CORS_ORIGINS: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_EXPIRY: z.string().default("15m"),
  JWT_REFRESH_EXPIRY: z.string().default("7d"),
  // The office timezone. Every attendance business-date derivation goes
  // through this, never through the server's locale — a UTC host at 20:00Z
  // is already tomorrow in Dhaka, and a US-region host would file every
  // morning check-in under the previous day.
  APP_TIMEZONE: z.string().default("Asia/Dhaka"),
  // The date attendance became the record of truth. Required with no default
  // on purpose: without a floor, every working day before the system existed
  // derives as ABSENT for every employee who joined earlier, and the first
  // monthly summary payroll sees is wrong for the whole company. A fixed
  // default would be wrong for later deployments, and a computed one would
  // silently move on every restart — so the only safe value is a decision.
  ATTENDANCE_GO_LIVE: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "ATTENDANCE_GO_LIVE must be a YYYY-MM-DD date"),
  // Company identity for the payslip and settlement documents. A payslip
  // without an employer name on it is not a document. All three have
  // defaults, unlike ATTENDANCE_GO_LIVE — a wrong company address is
  // cosmetic; a wrong go-live date corrupts the entire dataset. Only the
  // second justifies refusing to boot.
  COMPANY_NAME: z.string().default("Byte Spate"),
  COMPANY_ADDRESS: z.string().default(""),
  // Optional, following SMTP_HOST: an unconfigured integration degrades to a
  // clear 503 on upload rather than refusing to boot. Requiring them would
  // block every developer and every CI run on a Cloudinary account, for a
  // feature most work does not touch.
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
})
  // A From address is not optional once mail really leaves: sending from a
  // domain you do not own fails SPF and lands in spam, and inventing a
  // fallback domain only hides the misconfiguration until somebody wonders
  // why nothing ever arrives. Caught at boot, not at the first send.
  .refine((v) => !v.SMTP_HOST || !!v.EMAIL_FROM, {
    message: "EMAIL_FROM is required when SMTP_HOST is set",
    path: ["EMAIL_FROM"],
  })

export const env = envSchema.parse(process.env)
