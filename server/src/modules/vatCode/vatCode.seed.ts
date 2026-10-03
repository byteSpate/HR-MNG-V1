import prisma from "../../config/prisma"

// "No VAT" is a real code at 0%, so a line that carries no VAT still has a code
// and the VAT summary and the invoice read it like any other line. It lists
// after Standard 15% (the list is ordered by rate, highest first), so the
// standard rate stays the one chosen when a line is added.
export const VAT_CODES = [
  { code: "STD15", name: "Standard 15%", ratePercent: "15.00" },
  { code: "NOVAT", name: "No VAT", ratePercent: "0.00" },
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
