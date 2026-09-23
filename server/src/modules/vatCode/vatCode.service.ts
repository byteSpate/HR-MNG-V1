import prisma from "../../config/prisma"

export async function listVatCodes() {
  return prisma.vatCode.findMany({
    where: { isActive: true },
    orderBy: { ratePercent: "desc" },
  })
}
