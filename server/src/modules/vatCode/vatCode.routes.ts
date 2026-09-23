import { Router } from "express"
import { requireAuth } from "../../middleware/requireAuth"
import { listVatCodesHandler } from "./vatCode.controller"

const router = Router()
router.get("/", requireAuth, listVatCodesHandler)
export default router
