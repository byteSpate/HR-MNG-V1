import cookieParser from "cookie-parser"
import cors from "cors"
import express from "express"
import helmet from "helmet"
import morgan from "morgan"

import { parseOrigins } from "./config/cors"
import { env } from "./config/env"
import { errorHandler } from "./middleware/errorHandler"
import accountingRoutes from "./modules/accounting/accounting.routes"
import announcementRoutes from "./modules/announcement/announcement.routes"
import assetRoutes from "./modules/asset/asset.routes"
import attendanceRoutes from "./modules/attendance/attendance.routes"
import authRoutes from "./modules/auth/auth.routes"
import userRoutes from "./modules/auth/user.routes"
import costRoutes from "./modules/cost/cost.routes"
import dashboardRoutes from "./modules/dashboard/dashboard.routes"
import notificationRoutes from "./modules/notification/notification.routes"
import departmentRoutes from "./modules/department/department.routes"
import eventRoutes from "./modules/event/event.routes"
import expenseRoutes from "./modules/expense/expense.routes"
import employeeRoutes from "./modules/employee/employee.routes"
import depreciationRoutes from "./modules/depreciation/depreciation.routes"
import leaveRoutes from "./modules/leave/leave.routes"
import settlementRoutes from "./modules/settlement/settlement.routes"
import payrollRoutes from "./modules/payroll/payroll.routes"
import statementRoutes from "./modules/statements/statements.routes"
import postingRoutes from "./modules/posting/posting.routes"

const app = express()

// Heroku terminates TLS at its router and forwards the real client address in
// `X-Forwarded-For`. Without this, `req.ip` is the router's own address, so
// every session in the system would record the same IP and the sign-in list
// would show one indistinguishable location for the whole company.
//
// `1`, not `true`: trusting exactly one hop means a client cannot spoof its
// own address by sending an X-Forwarded-For header, because only the value
// the nearest proxy appended is believed.
app.set("trust proxy", 1)

app.use(helmet())
app.use(
  cors({
    origin: parseOrigins(env.CORS_ORIGINS, env.CLIENT_ORIGIN),
    credentials: true,
  })
)
app.use(cookieParser())
app.use(express.json())
app.use(morgan("dev"))

app.get("/health", (_req, res) => {
  res.json({ status: "ok" })
})

app.use("/api/auth", authRoutes)
app.use("/api/users", userRoutes)
app.use("/api/employees", employeeRoutes)
app.use("/api/departments", departmentRoutes)
app.use("/api/leave", leaveRoutes)
app.use("/api/attendance", attendanceRoutes)
app.use("/api/payroll", payrollRoutes)
app.use("/api/expenses", expenseRoutes)
app.use("/api/settlements", settlementRoutes)
app.use("/api/announcements", announcementRoutes)
app.use("/api/assets", assetRoutes)
app.use("/api/depreciation", depreciationRoutes)
app.use("/api/costs", costRoutes)
app.use("/api/accounting", accountingRoutes)
app.use("/api/statements", statementRoutes)
app.use("/api/posting-rules", postingRoutes)
app.use("/api/events", eventRoutes)
app.use("/api/dashboard", dashboardRoutes)
app.use("/api/emails", notificationRoutes)

app.use(errorHandler)

export default app
