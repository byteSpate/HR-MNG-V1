import cookieParser from "cookie-parser"
import cors from "cors"
import express, { type Router } from "express"
import helmet from "helmet"
import morgan from "morgan"

import { parseOrigins } from "./config/cors"
import { env } from "./config/env"
import { mountApiDocs } from "./apiDocs"
import { compressResponses } from "./middleware/compress"
import { errorHandler } from "./middleware/errorHandler"
import { requestMetrics } from "./observability/request-metrics"
import accountingRoutes from "./modules/accounting/accounting.routes"
import announcementRoutes from "./modules/announcement/announcement.routes"
import assetRoutes from "./modules/asset/asset.routes"
import attendanceRoutes from "./modules/attendance/attendance.routes"
import authRoutes from "./modules/auth/auth.routes"
import userRoutes from "./modules/auth/user.routes"
import costRoutes from "./modules/cost/cost.routes"
import customerRoutes from "./modules/customer/customer.routes"
import supplierRoutes from "./modules/supplier/supplier.routes"
import vatCodeRoutes from "./modules/vatCode/vatCode.routes"
import supplierBillRoutes from "./modules/supplierBill/supplierBill.routes"
import supplierPaymentRoutes from "./modules/supplierBill/supplierPayment.routes"
import supplierCreditNoteRoutes from "./modules/supplierBill/supplierCreditNote.routes"
import dealMoneyRoutes from "./modules/dealMoney/dealMoney.routes"
import customerPoRoutes from "./modules/receivables/customerPo.routes"
import invoiceRoutes from "./modules/receivables/invoice.routes"
import receiptRoutes from "./modules/receivables/receipt.routes"
import customerCreditNoteRoutes from "./modules/receivables/customerCreditNote.routes"
import receivablesReportsRoutes from "./modules/receivables/receivablesReports.routes"
import dashboardRoutes from "./modules/dashboard/dashboard.routes"
import notificationRoutes from "./modules/notification/notification.routes"
import salesRoutes from "./modules/sales/sales.routes"
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
app.use(compressResponses())
app.use(
  cors({
    origin: parseOrigins(env.CORS_ORIGINS, env.CLIENT_ORIGIN),
    credentials: true,
  })
)
app.use(cookieParser())
app.use(express.json())
// After the body parser on purpose: see request-metrics.ts.
app.use(requestMetrics({ log: env.PERF_LOG === "on" }))
// "dev" colours the line for a terminal. On Heroku that would put colour codes
// in the log, so production uses the plain format.
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"))

app.get("/health", (_req, res) => {
  res.json({ status: "ok" })
})

// One table, so the API docs page can read each router's prefix back.
// Express 5 does not keep it. The order is the order routes are matched in.
export const apiMounts: [string, Router][] = [
  ["/api/auth", authRoutes],
  ["/api/users", userRoutes],
  ["/api/employees", employeeRoutes],
  ["/api/departments", departmentRoutes],
  ["/api/leave", leaveRoutes],
  ["/api/attendance", attendanceRoutes],
  ["/api/payroll", payrollRoutes],
  ["/api/expenses", expenseRoutes],
  ["/api/settlements", settlementRoutes],
  ["/api/announcements", announcementRoutes],
  ["/api/assets", assetRoutes],
  ["/api/depreciation", depreciationRoutes],
  ["/api/costs", costRoutes],
  ["/api/accounting", accountingRoutes],
  ["/api/statements", statementRoutes],
  ["/api/posting-rules", postingRoutes],
  ["/api/events", eventRoutes],
  ["/api/dashboard", dashboardRoutes],
  ["/api/emails", notificationRoutes],
  ["/api/sales", salesRoutes],
  ["/api/customers", customerRoutes],
  ["/api/vat-codes", vatCodeRoutes],
  ["/api/supplier-bills", supplierBillRoutes],
  ["/api/supplier-payments", supplierPaymentRoutes],
  ["/api/supplier-credit-notes", supplierCreditNoteRoutes],
  ["/api/customer-pos", customerPoRoutes],
  ["/api/invoices", invoiceRoutes],
  ["/api/receipts", receiptRoutes],
  ["/api/customer-credit-notes", customerCreditNoteRoutes],
  ["/api/receivables", receivablesReportsRoutes],
  ["/api/suppliers", supplierRoutes],
  ["/api/deal-money", dealMoneyRoutes],
]
for (const [prefix, router] of apiMounts) {
  app.use(prefix, router)
}

mountApiDocs(app, apiMounts)

app.use(errorHandler)

export default app
