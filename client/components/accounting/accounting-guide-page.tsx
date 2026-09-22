import { FLOW, type FlowStepId } from "@/lib/help/accounting-help"
import { GLOSSARY } from "@/lib/help/glossary"
import { PageHeader } from "@/components/dashboard/page-header"
import { Term } from "@/components/help/term"
import { GuideRail, type RailItem } from "@/components/accounting/accounting-guide-rail"

/** Shorthand so a term is defined once here and its glossary sentence can
 *  never drift from `GLOSSARY`'s own wording. */
function T({ term }: { term: keyof typeof GLOSSARY }) {
  return <Term term={term} definition={GLOSSARY[term]} />
}

interface Step {
  id: FlowStepId
  eyebrow: string
  heading: string
  body: React.ReactNode
}

/** One line of a worked journal entry, for the compact ledger blocks. */
interface LedgerLine {
  side: "Debit" | "Credit"
  account: string
  amount: string
}

function LedgerLines({ lines }: { lines: LedgerLine[] }) {
  return (
    <dl className="my-4 rounded-md border border-[#E4E9EF] bg-white">
      {lines.map((line, i) => (
        <div
          key={i}
          className={`flex items-center justify-between gap-4 px-4 py-2 text-[12.5px] ${
            i > 0 ? "border-t border-[#EEF1F5]" : ""
          }`}
        >
          <div className="flex items-baseline gap-2.5">
            <span
              className={
                line.side === "Debit"
                  ? "w-14 shrink-0 text-[11px] font-bold tracking-wide text-[#3B4757] uppercase"
                  : "w-14 shrink-0 pl-3 text-[11px] font-bold tracking-wide text-[#8792A3] uppercase"
              }
            >
              {line.side}
            </span>
            <span className="text-[#3B4757]">{line.account}</span>
          </div>
          <span className="font-heading shrink-0 tabular-nums text-[#17191C]">{line.amount}</span>
        </div>
      ))}
    </dl>
  )
}

/** One "also connects this way" module: the distinctive Record/Post part
 *  only — Read, Report and Close work exactly as the payroll story already
 *  showed, so nothing here repeats them. */
interface ModuleEntry {
  id: string
  title: string
  trigger: React.ReactNode
  lines: LedgerLine[]
  note?: React.ReactNode
  also: string
}

const STEPS: Step[] = [
  {
    id: "setup",
    eyebrow: "1 · Before any money moves",
    heading: "The calendar has to exist first",
    body: (
      <>
        <p>
          Nothing can be recorded against a month that has not been created. A{" "}
          <T term="financial year" />{" "}is set up once, for this company 1 July to 30 June rather
          than the calendar year, and it is split into twelve <T term="accounting period" />s
          automatically. Each month can be open to new entries, closed, or, once a year, locked
          for good.
        </p>
        <p>
          The chart of accounts is the list of every account money can ever sit in: Salary
          Payable, Bank, Office Rent, and so on. It exists before anyone books anything, and it
          is also set up once, not built as you go.
        </p>
        <p>
          If the company already had money and obligations before the system went live, an{" "}
          <T term="opening balance" />{" "}carries those in: one figure per account, debit for what
          the company owns (cash, bank, equipment), credit for what it owes and what the owners
          put in (suppliers, loans, share capital). Say the company started with ৳5,00,000 in the
          bank, put in by its owners:
        </p>
        <LedgerLines
          lines={[
            { side: "Debit", account: "Bank", amount: "৳5,00,000" },
            { side: "Credit", account: "Share Capital", amount: "৳5,00,000" },
          ]}
        />
        <p>
          Every account gets one line this way, debits and credits are checked against each other
          as you type, and the whole set becomes a single opening entry, dated day one. Typed
          once, and never again. A correction afterwards is a fresh entry, not an edit to this
          one.
        </p>
      </>
    ),
  },
  {
    id: "record",
    eyebrow: "2 · The daily work",
    heading: "Say it's the 28th of July",
    body: (
      <>
        <p>This is where the story starts. It&apos;s the 28th, and it&apos;s time to process July&apos;s payroll.</p>
        <p>
          Processing builds a payslip for every employee from their salary structure and the
          month&apos;s attendance. At this point nothing has posted anywhere and nobody has been
          paid. It&apos;s a preview, and the last point at which everything is still freely
          changeable. If a number looks wrong, this is where to catch it.
        </p>
        <p>
          Payroll is one of several things recorded this way. An expense claim being approved, a
          supplier bill being entered, an employee being settled when they leave: all of these
          are &ldquo;record&rdquo; events too, and every one of them goes through the same four
          steps that follow. Section 7 below walks through each of those on its own.
        </p>
      </>
    ),
  },
  {
    id: "post",
    eyebrow: "3 · The moment it becomes real",
    heading: "Approve on the 29th",
    body: (
      <>
        <p>
          Approving the run is the consequential step. The moment it is signed off, the cost hits
          the books, whether or not anyone has actually been paid yet. July&apos;s accounts now carry
          the salary cost as an expense, and a separate account, Salary Payable, shows exactly
          what is owed:
        </p>
        <LedgerLines
          lines={[
            { side: "Debit", account: "Salary, Wages & Allowances", amount: "৳4,20,000" },
            { side: "Credit", account: "Salary Payable", amount: "৳4,20,000" },
          ]}
        />
        <p>
          Every entry like this is <T term="posting" />{" "}as one balanced record: it always has two
          sides, a <T term="debit" />{" "}and a <T term="credit" />, and the two sides always add up
          to the same total. Nobody chooses an account number while approving a payroll run; a set
          of posting rules decides that automatically, from the employee&apos;s department.
        </p>
        <p>
          Every posted entry, typed by a person or generated this way, lands in one place: the{" "}
          <T term="journal" />{" "}register, the full, searchable record of everything that has ever
          moved. Once posted there, it can never be edited or deleted, only undone by a{" "}
          <T term="reversal" />{" "}that says why.
        </p>
      </>
    ),
  },
  {
    id: "read",
    eyebrow: "4 · Seeing what's now in the books",
    heading: "Disburse on the 1st, then look",
    body: (
      <>
        <p>
          On the 1st of August, the money actually leaves. Disbursing the run records a second
          entry that clears what was owed against the bank:
        </p>
        <LedgerLines
          lines={[
            { side: "Debit", account: "Salary Payable", amount: "৳4,20,000" },
            { side: "Credit", account: "Bank", amount: "৳4,20,000" },
          ]}
        />
        <p>
          Salary Payable, which rose in the last step, drops back to zero. That&apos;s worth
          watching happen at least once: open the <T term="ledger" />
          {" "}on Salary Payable for July and follow it. Nil at the start of the month, rising when
          the run is approved, back to nil once it&apos;s disbursed. The general ledger is the same
          information as the journal register, sliced to one account over time, and it&apos;s the
          page to reach for whenever a figure looks wrong and you want to know how it got there.
        </p>
        <p>
          The cash book and bank book show the same thing from the other side: money physically
          moving, the way a chequebook or a bank statement reads. And the{" "}
          <T term="trial balance" />{" "}puts every account side by side at once, to prove the whole
          set of books is square. It&apos;s the check to run before anyone reads a report.
        </p>
      </>
    ),
  },
  {
    id: "report",
    eyebrow: "5 · What gets read and filed",
    heading: "The same figures, laid out to be read",
    body: (
      <>
        <p>
          Nothing on this step is typed by anyone. It is all computed straight from the ledger.
          July&apos;s payroll cost is now inside the Profit or Loss statement, as part of a larger
          figure: revenue, less cost of sales, less administrative expenses, down to a single
          profit or loss for the period.
        </p>
        <p>
          The Statement of Financial Position shows what the company owns and owes on one date.
          The Statement of Changes in Equity shows how the owners&apos; stake moved. Every one of the
          three carries a <T term="comparative" />
          {" "}column, because a figure on its own rarely
          means much; a figure next to last year&apos;s usually does.
        </p>
        <p>
          When it all needs to leave the building, for an auditor, for the board, it downloads
          as one PDF: the three statements, the supporting notes, the fixed-asset schedule and the
          written policies, together, with the date it was generated printed on every page.
        </p>
      </>
    ),
  },
  {
    id: "close",
    eyebrow: "6 · Locking it down",
    heading: "Closing July",
    body: (
      <>
        <p>
          Once July&apos;s figures have been checked and read, the month is closed. That stops
          anything else quietly landing in it. No backdated entry, however small, can change a
          report that has already gone out. It can be reopened later for a genuine correction, but
          only with a reason on record, because an unexplained reopening of a closed month is the
          first thing an auditor asks about.
        </p>
        <p>
          If it turns out afterwards that somebody in July&apos;s run was paid the wrong amount, the
          run itself cannot be edited. Approval was a one-way door. The fix is an adjustment on
          next month&apos;s run, with a reason, so both months read correctly and the correction is
          visible as a correction, not disguised as an ordinary payment.
        </p>
        <p>
          At the end of the whole financial year, one more thing happens once: every income and
          expense account, including July&apos;s payroll cost, is swept to zero, and the year&apos;s total
          profit or loss moves into <T term="retained earnings" />. Then the year itself is
          locked, permanently.
        </p>
      </>
    ),
  },
]

/**
 * Every debit/credit pair below is taken straight from the posting code that
 * actually runs — `expense.posting.ts`, `settlement.posting.ts`,
 * `cost.posting.ts`, `asset.capitalise.ts`, `depreciation.posting.ts` — not
 * inferred from account names. Amounts are illustrative; the accounts and
 * which side each lands on are real.
 */
const MODULES: ModuleEntry[] = [
  {
    id: "expenses",
    title: "Employee Expenses",
    trigger: (
      <>
        An employee spends their own money on something for work, a taxi, a client lunch, and
        claims it back. Finance approves a ৳1,200 taxi claim:
      </>
    ),
    lines: [
      { side: "Debit", account: "Travel and Conveyance", amount: "৳1,200" },
      { side: "Credit", account: "Employee Reimbursements Payable", amount: "৳1,200" },
    ],
    note: (
      <>
        It is not paid on its own. The next time that employee is paid, payroll clears Employee
        Reimbursements Payable and folds the money into the same bank transfer as their salary:
        one payment, not two.
      </>
    ),
    also: "Employee expenses",
  },
  {
    id: "settlements",
    title: "Settlements",
    trigger: (
      <>
        An employee leaves. Everything still owed to them (pending salary, gratuity, notice
        pay) is pulled into one final figure, less anything they still owe the company. Say
        ৳15,000 of pending salary and ৳40,000 of gratuity, minus a ৳5,000 advance they never
        repaid:
      </>
    ),
    lines: [
      { side: "Debit", account: "Salary, Wages & Allowances", amount: "৳15,000" },
      { side: "Debit", account: "Gratuity Expense", amount: "৳40,000" },
      { side: "Credit", account: "Employee Advances", amount: "৳5,000" },
      { side: "Credit", account: "Final Dues Payable", amount: "৳50,000" },
    ],
    note: (
      <>
        Paid the same way payroll is: Debit Final Dues Payable, Credit Bank, for the ৳50,000
        that is actually transferred.
      </>
    ),
    also: "Settlements",
  },
  {
    id: "operating-costs",
    title: "Operating Costs",
    trigger: (
      <>
        A bill for something the company simply consumes (rent, electricity, an internet
        line) arrives. A ৳45,000 office rent bill:
      </>
    ),
    lines: [
      { side: "Debit", account: "Office Rent", amount: "৳45,000" },
      { side: "Credit", account: "Trade and other Payables", amount: "৳45,000" },
    ],
    note: <>Paid later with Debit Trade and other Payables, Credit Bank, for the same ৳45,000.</>,
    also: "Expenses (company)",
  },
  {
    id: "assets",
    title: "Assets & Depreciation",
    trigger: (
      <>
        The company buys something it will use for years, not consume this month: an ৳85,000
        laptop.
      </>
    ),
    lines: [
      { side: "Debit", account: "Computer / Laptop", amount: "৳85,000" },
      { side: "Credit", account: "Trade and other Payables", amount: "৳85,000" },
    ],
    note: (
      <>
        Paid the same way as any bill. Then, every month afterwards, a small slice of that
        ৳85,000 moves on its own: Debit a Depreciation expense account, Credit Accumulated
        Depreciation, never touching the ৳85,000 the laptop cost, only building up beside it,
        so both figures stay readable separately.
      </>
    ),
    also: "Assets · Depreciation",
  },
  {
    id: "manual-journal",
    title: "A Hand-Typed Journal",
    trigger: (
      <>
        For whatever none of the above covers. The bank quietly takes a ৳150 fee nobody billed:
      </>
    ),
    lines: [
      { side: "Debit", account: "Bank Interest & Charges", amount: "৳150" },
      { side: "Credit", account: "Bank", amount: "৳150" },
    ],
    note: (
      <>
        Typed by one person, dated the day the bank took it, with the statement attached, and
        approved by someone else before it posts. Nobody approves their own entry.
      </>
    ),
    also: "Journals",
  },
]

const RAIL_ITEMS: RailItem[] = [
  ...STEPS.map((s) => ({ id: s.id, number: s.eyebrow.split(" · ")[0], label: s.eyebrow.split(" · ")[1] })),
  { id: "connections", number: "7", label: "Other kinds of entries" },
]

export function AccountingGuidePage() {
  return (
    <div className="pb-16">
      <PageHeader
        kicker="Accounting"
        title="How the accounting system fits together"
        sub="One real month, followed start to finish: where every figure comes from, and where it goes next."
      />

      <div className="flex max-w-[1280px] justify-between gap-10">
        <div className="min-w-0 max-w-[760px] flex-1 text-[13.5px] leading-[1.7] text-[#3B4757]">
          <p className="mb-10">
            This follows one real transaction, July&apos;s payroll, through every stage the accounts
            go through, in order. Every other kind of entry, from a hand-typed correction to an
            expense claim, goes through the exact same six steps; section 7 shows five of them
            with their own real numbers. Once this makes sense for payroll, it makes sense for the
            rest of the accounts too.
          </p>

          <ol className="space-y-12">
            {STEPS.map((step, i) => (
              <li
                key={step.id}
                id={step.id}
                className="animate-in fade-in slide-in-from-bottom-1 scroll-mt-20 fill-mode-backwards duration-300 motion-reduce:animate-none"
                style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}
              >
                <div className="mb-2 text-[11px] font-bold tracking-[0.08em] text-[#8792A3] uppercase">
                  {step.eyebrow}
                </div>
                <h2 className="font-heading mb-3 text-[17px] font-bold tracking-tight text-[#17191C] sm:text-[19px]">
                  {step.heading}
                </h2>
                <div className="space-y-3">{step.body}</div>
                <AlsoRecordedThisWay pages={FLOW.find((f) => f.id === step.id)?.pages ?? []} />
              </li>
            ))}
          </ol>

          <section
            id="connections"
            className="animate-in fade-in slide-in-from-bottom-1 scroll-mt-20 fill-mode-backwards mt-14 border-t border-[#EEF1F5] pt-10 duration-300 motion-reduce:animate-none"
          >
            <div className="mb-2 text-[11px] font-bold tracking-[0.08em] text-[#8792A3] uppercase">
              7 · Every other kind of entry
            </div>
            <h2 className="font-heading mb-3 text-[17px] font-bold tracking-tight text-[#17191C] sm:text-[19px]">
              The same shape, five more times
            </h2>
            <p className="mb-8">
              Every one of these still goes through Set up, Record, Post, Read, Report and Close
              exactly as July&apos;s payroll did above. That part never changes. What&apos;s different
              each time is only the Record and Post steps: what triggers the entry, and which
              accounts it debits and credits. That&apos;s the only part shown below.
            </p>

            <div className="space-y-8">
              {MODULES.map((mod) => (
                <div key={mod.id} className="rounded-lg border border-[#E4E9EF] p-5">
                  <h3 className="mb-2 text-[14px] font-bold text-[#17191C]">{mod.title}</h3>
                  <p className="mb-1">{mod.trigger}</p>
                  <LedgerLines lines={mod.lines} />
                  {mod.note ? <p className="text-[12.5px] text-[#5F6B7C]">{mod.note}</p> : null}
                  <p className="mt-4 text-[12px] text-[#8792A3]">
                    <span className="font-bold">Also recorded this way:</span> {mod.also}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <p className="mt-14 border-t border-[#EEF1F5] pt-6 text-[12.5px] text-[#5F6B7C]">
            That shape never changes: set up, record, post, read, report, close. A supplier&apos;s
            bill, a customer&apos;s invoice, a correction typed by hand: every one of them is a
            different door into the same six rooms.
          </p>
        </div>

        <aside className="hidden w-56 shrink-0 lg:block">
          <GuideRail items={RAIL_ITEMS} />
        </aside>
      </div>
    </div>
  )
}

function AlsoRecordedThisWay({ pages }: { pages: string[] }) {
  if (pages.length === 0) return null
  return (
    <p className="mt-5 text-[12px] leading-[1.6] text-[#8792A3]">
      <span className="font-bold">Also recorded this way:</span> {pages.join(" · ")}
    </p>
  )
}
