import prisma from "../../config/prisma"

export const VAT_CODES = [
  { code: "STD15", name: "Standard 15%", ratePercent: "15.00" },
  { code: "ZERO", name: "Zero-rated", ratePercent: "0.00" },
  { code: "EXEMPT", name: "Exempt", ratePercent: "0.00" },
]

export async function seedVatCodes(): Promise<void> {
  for (const row of VAT_CODES) {
    await prisma.vatCode.upsert({
      where: { code: row.code },
      update: {},
      create: row,
    })
  }
}
