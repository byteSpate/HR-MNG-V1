import type { NextFunction, Request, Response } from "express"

import { getHeatmapOverview } from "./heatmap.dashboard"
import { getSalesDashboard } from "./dashboard.service"
import { salesDashboardSchema } from "./dashboard.validators"

export async function getHeatmapOverviewHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const query = salesDashboardSchema.parse(req.query)
    return res.status(200).json(await getHeatmapOverview(query, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function getSalesDashboardHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const query = salesDashboardSchema.parse(req.query)
    return res.status(200).json(await getSalesDashboard(query, req.user!))
  } catch (err) {
    return next(err)
  }
}
