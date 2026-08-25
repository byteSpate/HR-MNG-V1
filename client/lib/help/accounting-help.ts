/**
 * Plain-language help for the accounting section.
 *
 * Four things are on screen, in this order: the flow the whole section
 * follows with the reader's current page marked on it; what feeds this page
 * and what it feeds; how to read what is actually displayed — the columns,
 * the badges, the number conventions; and then every action available, with
 * worked examples.
 *
 * The "how to read this" material matters as much as the actions. Somebody
 * looking at `(2,56,935.00)` and `—` in the same table has two questions
 * before they have any about buttons.
 *
 * The language is the product's own. No "debit the nominal ledger"; the
 * people using this run payroll for one company and half of them have never
 * taken an accounting class.
 */

export type FlowStepId = "setup" | "record" | "post" | "read" | "report" | "close"

export interface FlowStep {
  id: FlowStepId
  title: string
  body: string
  /** The pages that belong to this step, named as the sidebar labels them.
   *  Text, never links — the panel must not become a second navigation. */
  pages: string[]
}

/**
 * Six steps, numbered, because the order is the information — you cannot read
 * a ledger before something has posted into it, and you cannot close a month
 * you have not read.
 */
export const FLOW: FlowStep[] = [
  {
    id: "setup",
    title: "Set up",
    body: "Done once. The chart of accounts lists every account money can sit in. A financial year is created and split into twelve months. Opening balances carry in what the company already owned and owed on day one.",
    pages: ["Chart of accounts", "Years & periods", "Opening balances"],
  },
  {
    id: "record",
    title: "Record",
    body: "The daily work, and mostly not done in this section at all. A payroll run is approved, an expense claim is reimbursed, a supplier bill is entered, someone leaves and is settled. Anything those modules do not cover is typed as a journal by hand.",
    pages: ["Payroll", "Employee expenses", "Settlements", "Expenses"],
  },
  {
    id: "post",
    title: "Post",
    body: "Each of those events becomes one balanced entry in the ledger. The posting rules decide which account every figure lands in, so nobody types an account number while approving a payroll run.",
    pages: ["Posting rules", "Journals"],
  },
  {
    id: "read",
    title: "Read",
    body: "The same entries, sliced different ways. The general ledger shows one account over time. The cash and bank books show money moving. The trial balance shows every account at once, and proves the books are square.",
    pages: ["General ledger", "Cash book", "Bank book", "Trial balance"],
  },
  {
    id: "report",
    title: "Report",
    body: "The statements the company files, plus the notes that break them down, the schedule of fixed assets, and a PDF of the whole set. All of it is computed from the ledger — nothing here is typed twice.",
    pages: ["Financial statements", "Cash flow", "Notes", "Annexure-A", "Policy notes"],
  },
  {
    id: "close",
    title: "Close",
    body: "A month is closed so nothing can change behind a report that has already been read. At the end of the year, the profit or loss is swept into retained earnings and the year is locked.",
    pages: ["Years & periods"],
  },
]

export type HelpRole =
  | "SUPER_ADMIN"
  | "HR_ADMIN"
  | "FINANCE_OFFICER"
  | "REPORTING_MANAGER"
  | "EMPLOYEE"

export interface HelpFunction {
  name: string
  body: string
  /** The roles who can do this. Omitted when anyone who can reach the page can
   *  do it — a false "you cannot do this" is worse than a missing note. The
   *  accounting pages are already Finance-and-admin only, so this is mostly
   *  used to mark the handful of super-admin-only controls. */
  roles?: HelpRole[]
}

export interface HelpEntry {
  /** The page's own name, as the sidebar calls it. */
  title: string
  /** One or two sentences: what this page is for. */
  lede: string
  step: FlowStepId
  /** Where the figures on this page come from, and what reads them. */
  connects?: { fedBy?: string[]; feeds?: string[] }
  /** How to read what is on screen: columns, badges, states, conventions. */
  reading?: HelpFunction[]
  /** Every action available here. */
  does: HelpFunction[]
  /** One or more worked examples. */
  scenarios: { title: string; steps: string[] }[]
  /** Things that surprise people. */
  watchFor?: string[]
}

/** Repeated verbatim wherever a table shows money, because it is the first
 *  thing people ask and it is true on every one of them. */
const NUMBER_CONVENTIONS: HelpFunction = {
  name: "How the numbers are printed",
  body: "Amounts are grouped the South Asian way, so twelve lakh reads 12,34,567.00 rather than 1,234,567.00. A dash means the cell is genuinely nil, while a totals row prints 0.00 so a zero total is never mistaken for a missing one. A figure in brackets is negative — (2,56,935.00) is a loss of two lakh fifty-six thousand, which is the convention the company's audited statements use. Every figure is in taka; the ledger is a single-currency book, and a bill in dollars is converted once, at the moment it posts, at a rate that is then frozen.",
}

export const HELP: Record<string, HelpEntry> = {
  // ── Set up ────────────────────────────────────────────────────────────────
  "accounting/accounts": {
    title: "Chart of accounts",
    lede: "The list of every account money can sit in, arranged as a tree. Everything else in this section is a view of figures that landed on one of these.",
    step: "setup",
    connects: {
      fedBy: ["The seeded chart, taken line by line from the company's audited statements"],
      feeds: ["Journals", "General ledger", "Trial balance", "All five statements", "Posting rules"],
    },
    reading: [
      {
        name: "Groups and accounts",
        body: "A row in bold with children under it is a group — a heading like Non-Current Assets or Administrative & Selling Expenses. Groups hold no money of their own; their figure is whatever their children add up to. The rows underneath are the real accounts, and those are the only things a journal line can point at.",
      },
      {
        name: "The four-digit code",
        body: "The first digit is the account's type. 1000s are assets, things the company owns or is owed. 2000s are liabilities, things it owes. 3000s are equity, what the owners have put in and what has been retained. 4000s are income. 5000s are expenses. The rest of the code positions the account inside its group, so 5201 sits under the 5200 administrative block.",
      },
      {
        name: "Why the codes are not sequential",
        body: "There are gaps on purpose. A new account can be slotted between two existing ones without renumbering anything, and every code that has ever appeared on a report keeps meaning the same thing forever.",
      },
      {
        name: "Inactive accounts",
        body: "Shown greyed rather than hidden. An inactive account cannot be chosen when writing a new journal, but it keeps every entry it ever had and still appears on reports covering the period it was in use.",
      },
    ],
    does: [
      {
        name: "Browse the tree",
        body: "Expand a group to see what sits under it. This is the fastest way to answer \"where would a cost like this go\" — find the group that matches, and read its children.",
      },
      {
        name: "Search by code or name",
        body: "Matches on both, so typing 52 finds the whole administrative block and typing rent finds the rent account wherever it lives. The tree collapses to just the matches and their parents, so you keep the context of where a result sits.",
      },
      {
        name: "Add an account",
        body: "Needs a code, a name, a type, and the group it belongs under. New expense categories, new asset classes and new income lines are all added here rather than by a developer. Pick the code by looking at its neighbours — an account in the wrong numeric range still works, but it will sort into the wrong place on every report forever.",
      },
      {
        name: "Convert an account into a group",
        body: "An account that needs children has to become a group first. The system will tell you so when you try to file something underneath it. Converting is refused once the account itself has entries, because a group cannot hold figures of its own.",
      },
      {
        name: "Rename an account",
        body: "Safe at any time. The name is a label; the code and the identity behind it do not change, so nothing on a past report breaks. The new name appears everywhere, including on reports covering earlier periods.",
      },
      {
        name: "Move an account to a different group",
        body: "Changes which subtotal it rolls into, on every report, including past ones. Reports are computed from the tree as it is now, not as it was — so moving an account rewrites history's shape, though never its figures.",
      },
      {
        name: "Mark an account inactive",
        body: "The way to retire an account that has been used. It stops appearing in the journal editor's picker so nobody adds to it by accident, and everything it already holds stays exactly where it is.",
      },
      {
        name: "Delete an account",
        body: "Only possible while nothing has ever posted to it. One entry against an account and deletion is refused, because removing it would leave that entry pointing at nothing and silently change every total it contributed to. Mark it inactive instead.",
      },
    ],
    scenarios: [
      {
        title: "The company starts paying for a software subscription",
        steps: [
          "Search the 52xx range and find nothing that fits — there is stationery, there is internet, there is nothing for software.",
          "Add \"Software subscriptions\" as a new account under Administrative & Selling Expenses, with the next free code in that range.",
          "Go to Posting rules and point the relevant expense category at the new account.",
          "The next bill entered lands there automatically, and it appears as its own line in the notes to the statements rather than being buried in miscellaneous.",
        ],
      },
      {
        title: "An account was set up under the wrong heading",
        steps: [
          "A cleaning cost was filed under Cost of Goods Sold and should be administrative.",
          "Edit the account and change its parent to the administrative group.",
          "Nothing in the ledger moves — the entries are unchanged and still point at the same account.",
          "The Profit or Loss statement now shows that cost above the administrative subtotal instead of the gross profit one, for every period including past ones.",
        ],
      },
    ],
    watchFor: [
      "An account cannot be moved underneath one of its own children. The system refuses it, because a loop detaches that whole branch from every root and it would quietly vanish from statement totals while still appearing in the trial balance.",
      "Groups cannot be posted to. If a journal refuses an account for being a group, pick one of the accounts underneath it — or add one if none fits.",
      "Moving or renaming changes past reports' presentation. If a filed set of accounts has to keep reading exactly as filed, do not restructure the chart after it has been signed off.",
    ],
  },

  "accounting/periods": {
    title: "Financial years & periods",
    lede: "The calendar the whole ledger runs on. One financial year, split into twelve months, each of which can be open or shut to new entries.",
    step: "setup",
    connects: {
      fedBy: ["Nothing — this is where the calendar is defined"],
      feeds: ["Every posting anywhere in the system", "The period picker on all statements"],
    },
    reading: [
      {
        name: "Open",
        body: "Entries can post into this month, from anywhere — a hand-typed journal, a payroll approval, a supplier bill, a depreciation run.",
      },
      {
        name: "Closed",
        body: "Shut to new entries. Anything trying to post into it is refused with a message saying so, and the module that tried rolls back completely rather than half-committing. A closed month can be reopened.",
      },
      {
        name: "Locked",
        body: "The end state, set when the whole year is locked after its year-end entry. Nothing in a locked year can be changed by anybody, and there is no unlock.",
      },
      {
        name: "The year runs July to June",
        body: "Not January to December. This matters everywhere a period is chosen: the first quarter of the financial year is July to September, and \"this year\" in a report means the July–June span, not the calendar one.",
      },
    ],
    does: [
      {
        name: "Create a financial year",
        body: "Pick a start date, which must be the first of a month. Creating the year creates its twelve months at the same time, all open. Do this before the year begins — a payroll run in a month that has no period behind it cannot post at all.",
        roles: ["SUPER_ADMIN"],
      },
      {
        name: "Close a month",
        body: "Closes the door on it. This is what stops a report being read on Monday and quietly changing by Wednesday because somebody backdated an entry into a month everyone had finished with. Close in order, after the trial balance for that month agrees.",
        roles: ["SUPER_ADMIN"],
      },
      {
        name: "Reopen a month",
        body: "Possible, and it asks why. The reason is required and recorded against the period, because an unexplained reopen of a closed month is the first thing an auditor asks about. Reopen, fix, close again — do not leave it open.",
        roles: ["SUPER_ADMIN"],
      },
      {
        name: "Draft the year-end entry",
        body: "At the end of the year this sweeps every income and expense account to zero and moves the difference — the year's profit or loss — into retained earnings. It arrives as a draft journal you can read line by line before anything posts. It is computed from the ledger, not typed.",
        roles: ["FINANCE_OFFICER", "SUPER_ADMIN"],
      },
      {
        name: "Lock the year",
        body: "The final step, after the year-end entry has posted. The system re-derives the closing figure before it locks and refuses if it disagrees with what was posted, because the final month has to stay open until the year-end entry lands — which is exactly the window in which somebody else can still post something.",
        roles: ["SUPER_ADMIN"],
      },
      {
        name: "Delete a financial year",
        body: "Only while it holds nothing. Once a single entry exists in any of its months, the year is history.",
        roles: ["SUPER_ADMIN"],
      },
    ],
    scenarios: [
      {
        title: "The normal month-end",
        steps: [
          "Payroll for the month has been approved and disbursed, and the last supplier bills are in.",
          "Open the trial balance for that month and confirm it agrees.",
          "Skim it for anything obviously in the wrong place — a large balance sitting on an account that is normally empty.",
          "Close the month here. Reports for it are now stable.",
        ],
      },
      {
        title: "Finishing the financial year",
        steps: [
          "Close July through May as usual, but leave June open — the year-end entry has to post into it.",
          "Confirm the full-year trial balance agrees.",
          "Draft the year-end entry and read the figure it moves into retained earnings. It should equal the profit or loss on the Profit or Loss statement for the year.",
          "Post it, then close June, then lock the year.",
        ],
      },
      {
        title: "Something has to be corrected after the month closed",
        steps: [
          "Reopen the month, giving the reason.",
          "Post a correcting journal, or reverse the wrong one and write a fresh entry.",
          "Re-read the trial balance and the affected statement.",
          "Close the month again the same day. A month left open by accident is a month that will drift.",
        ],
      },
    ],
    watchFor: [
      "Closing a month while a payroll run is approved but not yet disbursed will stop the disbursement. Close after payday, not before.",
      "The last month of the year must stay open until the year-end entry is posted. That window is real, and the lock step re-checks the figure precisely because of it.",
      "A month with no period behind it at all is not the same as a closed one — it produces a \"no financial year covers this date\" refusal. That means the year was never created, and creating it is the fix.",
    ],
  },

  "accounting/opening-balances": {
    title: "Opening balances",
    lede: "What the company already owned and owed on the day it started using this system. Entered once, at the start of the first financial year.",
    step: "setup",
    connects: {
      fedBy: ["Whatever was used before — a spreadsheet, or last year's audited balance sheet"],
      feeds: ["Every balance in the system, forever"],
    },
    reading: [
      {
        name: "The two columns",
        body: "Debit for things the company owns or is owed — cash, bank, equipment, money customers owe. Credit for things it owes and for what the owners put in — suppliers, loans, share capital, retained earnings brought forward.",
      },
      {
        name: "The running difference",
        body: "Shown as you type. It must reach zero before anything can be posted. A company's books always add up: what it owns equals what it owes plus what the owners hold. A non-zero difference means a fact has not been entered yet, not that the form is broken.",
      },
      NUMBER_CONVENTIONS,
    ],
    does: [
      {
        name: "Choose the financial year",
        body: "Opening balances belong to the first year. The entry that gets created is dated its first day.",
      },
      {
        name: "Enter a figure per account",
        body: "Work down the balance sheet you are carrying in. Cash in hand, each bank account, equipment at cost, accumulated depreciation to date, money owed to suppliers, share capital, retained earnings. Every account in the chart is available; most will stay blank.",
      },
      {
        name: "Post them",
        body: "Turns the whole set into a single opening journal dated the first day of the year, marked as an opening entry so it is distinguishable from everything typed afterwards. From that moment every report includes it.",
        roles: ["FINANCE_OFFICER", "SUPER_ADMIN"],
      },
    ],
    scenarios: [
      {
        title: "Starting mid-life, not from scratch",
        steps: [
          "Take the closing balance sheet from whatever was used before.",
          "Enter each line against the matching account here — assets on the debit side, liabilities and equity on the credit side.",
          "Include accumulated depreciation as a credit against its own account, not netted off the equipment cost. The fixed asset schedule needs both figures separately.",
          "The difference reads zero once the whole balance sheet is in. Post.",
          "The first trial balance now starts from reality rather than from nothing.",
        ],
      },
    ],
    watchFor: [
      "This is done once. Correcting it afterwards means a reversing journal, not an edit here, because reports have already been produced from it.",
      "If the difference will not close, the usual culprits are retained earnings brought forward and accumulated depreciation — both are easy to leave out and both are large.",
    ],
  },

  // ── Post ──────────────────────────────────────────────────────────────────
  "posting-rules": {
    title: "Posting rules",
    lede: "The map that decides which account each figure lands in when payroll, expenses, costs and settlements post. It exists so nobody types an account number while approving a payroll run.",
    step: "post",
    connects: {
      fedBy: ["The chart of accounts, which is where the rules point"],
      feeds: ["Every entry payroll, expenses, operating costs and settlements produce"],
    },
    reading: [
      {
        name: "Events",
        body: "Rules are grouped by the moment they apply. Payroll accrual is when a run is approved and the cost hits the books; payroll payment is when the money leaves. Expenses, operating costs and settlements each have their own accrual and payment events. Asset acquisition, payment, depreciation and disposal are there too.",
      },
      {
        name: "Keys",
        body: "The left-hand side of each rule. A key like ADMINISTRATIVE:BASIC means basic salary for someone in an administrative department; DEDUCTION:TDS means tax withheld. A key like RENT or ELECTRICITY is an operating cost category. NET_PAY, PAYABLE and BANK are the standing keys every event needs.",
      },
      {
        name: "How a key is resolved",
        body: "Three steps, in order. An exact match wins. Failing that, a wildcard on the part before the colon — ADMINISTRATIVE:* catches every administrative salary head that has no rule of its own. Failing that, a bare * if the event has one. If none of those match, the posting stops with an error naming the key.",
      },
      {
        name: "The unresolved list",
        body: "Keys the system has encountered with no rule behind them. This is the early warning: a new allowance or a new expense category shows up here the first time a run is previewed, before it stops anything.",
      },
    ],
    does: [
      {
        name: "Re-point a rule",
        body: "Change the account a key resolves to. It takes effect on the next thing that posts. Already-posted entries do not move — they are history, and a rule change is not retroactive.",
        roles: ["FINANCE_OFFICER", "SUPER_ADMIN"],
      },
      {
        name: "Leave a note on a rule",
        body: "For the ones that need explaining later. Several rules are deliberately pointed at a shared account with a note saying so, waiting for a dedicated one — the note is how the next person knows that was a decision rather than an accident.",
        roles: ["FINANCE_OFFICER", "SUPER_ADMIN"],
      },
      {
        name: "Read the unresolved list and act on it",
        body: "Anything listed will stop a posting when it is next encountered for real. Adding the missing rule is the fix, and it takes effect immediately with no deploy.",
      },
    ],
    scenarios: [
      {
        title: "HR adds a transport allowance to the salary structure",
        steps: [
          "The new allowance appears in the unresolved list the first time a payroll run is previewed.",
          "Decide which account it belongs to — probably alongside the other salary heads, possibly its own line if it needs to be visible in the accounts.",
          "Point the rule at it.",
          "The run processes and approves. Nobody edited any code, and nothing was deployed.",
        ],
      },
      {
        title: "Electricity has been landing in miscellaneous",
        steps: [
          "Add a dedicated electricity account in the chart if there is not one.",
          "Find the ELECTRICITY key under the operating cost accrual event and re-point it.",
          "Bills entered from now on land on the new account.",
          "The ones already posted stay where they are. If they need moving, that is a reversing journal, not a rule change.",
        ],
      },
    ],
    watchFor: [
      "A key that matches no rule stops the posting rather than falling back to something plausible. That is deliberate — a figure that lands on a nearly-right account is invisible until somebody reads the statements months later.",
      "Some events have a bare wildcard as a safety net and some deliberately do not. Asset acquisition has none, because a chair capitalised as a laptop would be invisible until the fixed asset schedule is read by somebody who knows the company.",
      "Re-pointing a rule never moves what has already posted. If the correction has to reach the ledger, it is a journal.",
    ],
  },

  "accounting/journals": {
    title: "Journal register",
    lede: "Every entry in the ledger, whether a person typed it or the system generated it. This is the searchable record of everything that has ever moved.",
    step: "post",
    connects: {
      fedBy: ["Payroll", "Employee expenses", "Expenses", "Settlements", "Asset capitalisation and depreciation", "Hand-typed entries", "The year-end sweep"],
      feeds: ["General ledger", "Cash and bank books", "Trial balance", "Every statement"],
    },
    reading: [
      {
        name: "Draft",
        body: "Typed but not submitted. Only visible as a working document; it affects nothing and appears on no report.",
      },
      {
        name: "Awaiting approval",
        body: "Submitted, waiting for somebody else to approve it. Still affects nothing.",
      },
      {
        name: "Posted",
        body: "In the ledger. Every report includes it from here on. It cannot be edited or deleted, only reversed.",
      },
      {
        name: "Reversed",
        body: "A posted entry that has been superseded by a reversing entry. Both stay visible and both stay in the ledger — the two net to nothing, which is why an account that was moved and moved back reads as two rows rather than none.",
      },
      {
        name: "The type column",
        body: "Opening is the one-off carry-in of starting balances. Manual is typed by a person. System is generated by payroll, expenses, costs, settlements or a depreciation run. Reversal undoes an earlier entry. Year-end is the annual sweep of income and expenses into retained earnings.",
      },
      {
        name: "Why system entries are already posted",
        body: "They never enter the approval queue. A human already approved the payroll run itself, and asking a second person to approve the arithmetic that follows from it would be a rubber stamp — which weakens the control on the entries that genuinely need scrutiny.",
      },
      NUMBER_CONVENTIONS,
    ],
    does: [
      {
        name: "Search",
        body: "Matches the entry number, the narration and the reference field in one box. Searching a supplier's name finds every bill narrated with it.",
      },
      {
        name: "Filter by status and type",
        body: "The two most useful filters. Status finds everything awaiting approval; type separates what people typed from what the system generated, which is usually the first cut when investigating.",
      },
      {
        name: "Filter by date range",
        body: "Defaults to the current month. The range is on the entry's own date — the date it is booked to — not the date somebody typed it.",
      },
      {
        name: "Filter by account",
        body: "Every entry touching one account. Useful when the general ledger has shown you a figure and you want the whole entry that produced it, on both sides.",
      },
      {
        name: "Open an entry",
        body: "Shows every line with its account and amount, the narration, who created it, who approved it, when it posted, any per-line notes, and anything attached.",
      },
      {
        name: "Approve or send back",
        body: "Approving posts the entry immediately. Sending it back asks for a note saying what is wrong and returns it to its author as a draft.",
        roles: ["SUPER_ADMIN"],
      },
      {
        name: "Reverse a posted entry",
        body: "Creates a second entry that mirrors the first, with the sides swapped, and marks the original as reversed. It asks for a reason. This is the only way to undo something that has posted.",
        roles: ["FINANCE_OFFICER", "SUPER_ADMIN"],
      },
      {
        name: "Attach a document",
        body: "The receipt, the invoice, the bank advice. Attachments can still be added after posting, because paperwork often arrives later than the entry. They cannot be removed after posting.",
      },
      {
        name: "Delete a draft",
        body: "Only drafts. Deleting a draft reversal releases the original back to posted, and that release is recorded.",
      },
    ],
    scenarios: [
      {
        title: "A supplier invoice was booked to the wrong account",
        steps: [
          "Find the entry in the register — search the supplier's name, or filter by the account it wrongly landed on.",
          "Open it and confirm it is the right one by checking the amount and the date.",
          "Reverse it, with a reason naming the account it should have been.",
          "Write a fresh entry with the right account.",
          "All three entries stay on the record. Nothing was erased, and the reason it changed is answerable a year later.",
        ],
      },
      {
        title: "Working out where a figure on a report came from",
        steps: [
          "Note the account and the period from the report.",
          "Filter the register by that account and that date range.",
          "The entries listed are exactly what made up the figure.",
          "Open any of them to see the other side — what the money came from, or went to.",
        ],
      },
      {
        title: "Clearing the approval queue",
        steps: [
          "Filter by status: awaiting approval.",
          "Open each one and read the narration first — it should say what happened and why, not just repeat the account names.",
          "Check the lines balance and the date falls in the right month.",
          "Approve, or send it back with a note. A note saying \"wrong account\" is less useful than one naming the right account.",
        ],
      },
    ],
    watchFor: [
      "You cannot approve your own entry. Two people, always — that is the entire point of the queue, and the system enforces it rather than trusting people to remember.",
      "Reversal and year-end entries cannot have their lines retyped, only their narration. Retyping a reversal's lines would leave the original marked as reversed by something that no longer reverses it.",
      "A reversal does not delete anything. If a report looks like it double-counts after a reversal, read again — the two entries net to zero and the ledger is correct.",
    ],
  },

  "accounting/journals/new": {
    title: "Writing a journal",
    lede: "A hand-typed entry, for anything the payroll, expense, cost, settlement and asset modules do not already post for you — a bank charge, an accrual, a correction.",
    step: "post",
    connects: {
      fedBy: ["Whatever paperwork you are working from"],
      feeds: ["The journal register, and from there every ledger and statement"],
    },
    reading: [
      {
        name: "Debit and credit",
        body: "Every line goes on one side or the other. The short version that gets you through most entries: a debit increases something the company owns or a cost it has incurred; a credit increases something it owes, or income it has earned. Money leaving the bank is a credit to the bank; a cost is a debit.",
      },
      {
        name: "The running difference",
        body: "Updates as you type and must reach zero before you can submit. It is computed in whole paisa rather than in decimals, so it agrees exactly with the check the server does — no entry is ever rejected for a rounding disagreement you cannot see.",
      },
      {
        name: "The date decides the month",
        body: "Not the day you type it. An entry dated 31 July lands in July and appears on July's reports, whenever it was written.",
      },
    ],
    does: [
      {
        name: "Set the date",
        body: "It has to fall inside a month that is open. If the month has closed, either reopen it with a reason or date the entry into the current one, depending on which is actually true.",
      },
      {
        name: "Write the narration",
        body: "What a reader sees first, in the register and on every ledger row this entry produces. Write it for somebody opening this in a year's time who was not in the room: \"Bank charges — August\" beats \"charges\".",
      },
      {
        name: "Add a reference",
        body: "Optional. The invoice number, the bank advice number, the cheque number — whatever a person would search for. The register searches this field alongside the narration.",
      },
      {
        name: "Add lines",
        body: "Each line names an account and an amount on one side. Two lines is the common case; there is no upper limit, and a payroll entry has dozens. The account picker searches by code and name and excludes groups and inactive accounts, so anything it offers is postable.",
      },
      {
        name: "Note a line",
        body: "Optional text on a single line, for when one line inside a larger entry needs explaining on its own. It shows on that ledger row, which is where somebody investigating will be looking.",
      },
      {
        name: "Attach supporting documents",
        body: "The paperwork the entry came from. Attaching before submitting means the approver can see what you saw.",
      },
      {
        name: "Save as a draft",
        body: "Yours to keep working on. Drafts affect nothing and appear on no report.",
      },
      {
        name: "Submit for approval",
        body: "Sends it to somebody else. You cannot approve your own, so submitting is the end of your part.",
      },
    ],
    scenarios: [
      {
        title: "The bank charged a fee nobody billed",
        steps: [
          "Date it the day the bank took it.",
          "Narrate it \"Bank charges — August\" and reference the statement line.",
          "One line debiting bank charges, one crediting the bank account, the same amount on each.",
          "The difference reads zero. Attach the statement page and submit.",
          "A colleague approves it and it posts.",
        ],
      },
      {
        title: "A cost belongs to a month whose invoice has not arrived",
        steps: [
          "Date the entry the last day of the month it belongs to, while that month is still open.",
          "Debit the expense account, credit trade and other payables, for the best estimate.",
          "Narrate it clearly as an accrual, so the person who sees the real invoice next month knows to expect it.",
          "When the invoice arrives, reverse the accrual and enter the real bill.",
        ],
      },
    ],
    watchFor: [
      "A group heading cannot be used on a line. The picker will not offer one; if you paste a code and it is refused, pick one of the accounts underneath it.",
      "If the date falls in a closed month the entry is refused at submission. Deciding between reopening the month and redating the entry is a judgement about which is true, not a workaround.",
      "An entry that balances can still be wrong. Balancing only proves the two sides are equal, not that either side is on the right account.",
    ],
  },

  // ── Read ──────────────────────────────────────────────────────────────────
  "accounting/ledger": {
    title: "General ledger",
    lede: "One account, every movement, in date order, with a running balance. The page you open when a figure looks wrong and you want to know how it got there.",
    step: "read",
    connects: {
      fedBy: ["Every posted journal, whoever or whatever produced it"],
      feeds: ["Nothing — this is a read of the ledger, not a source"],
    },
    reading: [
      {
        name: "Opening balance",
        body: "The first row. Everything that happened before the range you chose, condensed into one figure. Change the start date and this figure changes with it.",
      },
      {
        name: "The running balance",
        body: "The account's position after each entry, in order. This is the column that answers \"when did it go wrong\" — scan down until the balance stops matching what you expected.",
      },
      {
        name: "Period total",
        body: "The debits and credits inside the range, summed. Together with the opening balance this gives the closing figure, which is what appears on the statements.",
      },
      {
        name: "The journal column",
        body: "The entry number each row came from, and a link to it. Every row on this page is one line of a larger entry — the link is how you see the other side.",
      },
      {
        name: "Reversed entries are shown, not hidden",
        body: "So are their reversals. An account that was moved and then moved back reads as two rows netting to nothing, which is the truth. Hiding one of them would leave the balance looking unexplained.",
      },
      NUMBER_CONVENTIONS,
    ],
    does: [
      {
        name: "Pick an account",
        body: "Any account in the chart, searched by code or name.",
      },
      {
        name: "Pick a date range",
        body: "Defaults to the current month. The range decides the opening balance and which rows appear below it.",
      },
      {
        name: "Jump to the entry behind a row",
        body: "Every row links to its journal, so you can see the whole entry, its narration, who approved it, and anything attached.",
      },
      {
        name: "See what produced a row",
        body: "Rows generated by payroll, expenses, costs, settlements or a depreciation run are marked as system entries, so you can tell a monthly run from a typed correction without opening either.",
      },
    ],
    scenarios: [
      {
        title: "Salary payable is not zero and it should be",
        steps: [
          "Open the ledger on the salary payable account for the month.",
          "The accrual is there when the run was approved, the payment is there when it was disbursed, and a small amount is left over.",
          "Follow the running balance to the row where it stops returning to zero.",
          "Click through to that entry: an adjustment was accrued and never included in the disbursement.",
          "Now you know whether it is genuinely still owed or was booked twice.",
        ],
      },
      {
        title: "An expense account looks too high for the month",
        steps: [
          "Open the ledger on it for that month.",
          "Read down the narrations rather than the figures — the wrong entry is usually obvious from what it says.",
          "If nothing stands out, widen the range by a month either side: the usual cause is something dated into the wrong month, which makes one month high and its neighbour low.",
        ],
      },
    ],
    watchFor: [
      "The opening balance depends entirely on the start date you chose. Two people reading \"the same\" ledger with different ranges will see different opening figures and both are right.",
      "An account with no rows is not necessarily unused — it may simply have had nothing happen inside this range.",
    ],
  },

  "accounting/cash-book": {
    title: "Cash book",
    lede: "Cash in and out, in date order. The general ledger narrowed to accounts that hold physical cash, laid out the way a cash book is read.",
    step: "read",
    connects: {
      fedBy: ["Every posted entry touching a cash account"],
      feeds: ["Nothing — this is a read"],
    },
    reading: [
      {
        name: "Receipts and payments",
        body: "Money in on one side, money out on the other, with the balance after each. The closing balance is what should physically be in the box.",
      },
      {
        name: "Only cash accounts appear",
        body: "An account shows here because it is marked as a cash account in the chart. If the picker is empty, none have been marked yet — that is a chart of accounts setting, not a missing feature.",
      },
      NUMBER_CONVENTIONS,
    ],
    does: [
      {
        name: "Pick a cash account and a range",
        body: "Defaults to the current month.",
      },
      {
        name: "Follow a row to its entry",
        body: "As on the general ledger — every row links to the journal that produced it.",
      },
    ],
    scenarios: [
      {
        title: "Counting the petty cash tin at month end",
        steps: [
          "Open the cash book for the month and read the closing balance.",
          "Count the tin.",
          "If the tin has less, there is a payment nobody recorded — usually a small purchase with the receipt still in somebody's pocket.",
          "If the tin has more, there is a receipt nobody recorded, or a payment recorded that never happened.",
          "Either way the fix is a journal, dated when it actually happened if that month is still open.",
        ],
      },
    ],
  },

  "accounting/bank-book": {
    title: "Bank book",
    lede: "The same view as the cash book, for bank accounts. This is the page to hold next to a bank statement.",
    step: "read",
    connects: {
      fedBy: ["Every posted entry touching a bank account — payroll disbursements, supplier payments, receipts"],
      feeds: ["Nothing — this is a read"],
    },
    reading: [
      {
        name: "Deposits and withdrawals",
        body: "With a running balance, so the closing figure can be read against the bank's own.",
      },
      {
        name: "Only bank accounts appear",
        body: "An account shows here because it is marked as a bank account in the chart.",
      },
      NUMBER_CONVENTIONS,
    ],
    does: [
      {
        name: "Pick a bank account and a range",
        body: "One account at a time. A company with three bank accounts reconciles three times.",
      },
      {
        name: "Follow a row to its entry",
        body: "Every row links to the journal behind it.",
      },
    ],
    scenarios: [
      {
        title: "The bank says one figure and the books say another",
        steps: [
          "Open the bank book for the month and read the closing balance.",
          "Work down against the bank statement, ticking what appears on both.",
          "What is in the books and not on the statement has not cleared yet — a cheque written and not presented. That is a timing difference and needs no entry.",
          "What is on the statement and not in the books has not been recorded. Usually a charge, an interest credit, or a direct debit nobody told finance about. Those need journals.",
        ],
      },
    ],
    watchFor: [
      "A difference is not automatically an error. Uncleared payments are normal at any month end; the question is whether they clear next month.",
    ],
  },

  "accounting/trial-balance": {
    title: "Trial balance",
    lede: "Every account, side by side, proving the books are square. The check to run before anybody reads a statement.",
    step: "read",
    connects: {
      fedBy: ["Every posted journal"],
      feeds: ["Nothing directly, but the statements refuse to generate while this does not agree"],
    },
    reading: [
      {
        name: "Opening, Movement, Closing",
        body: "Three pairs of columns. Opening is where each account stood before the range. Movement is what happened inside it. Closing is opening plus movement, and closing is what the statements use.",
      },
      {
        name: "Why each pair has two columns",
        body: "An account sits naturally on one side — assets and expenses on the debit side, liabilities, equity and income on the credit side. Showing both columns means an account sitting on the wrong side is visible at a glance rather than hidden inside a signed figure.",
      },
      {
        name: "The totals row",
        body: "The two totals must be identical. When they are, the page confirms it. When they are not, it says \"Not balanced\" and the statements will refuse to generate.",
      },
      {
        name: "What a closed year looks like",
        body: "Once a year has been closed, its income and expense accounts read zero, because the year-end entry swept them into retained earnings. That is correct, not a fault. The balance sheet accounts still carry their figures.",
      },
      NUMBER_CONVENTIONS,
    ],
    does: [
      {
        name: "Choose a date range",
        body: "A month, a quarter, a year, or anything custom. Note that quarters run from the financial year's start, so the first quarter is July to September.",
      },
      {
        name: "Read every account at once",
        body: "This is the only page that shows the whole ledger on one screen. It is the fastest way to spot a balance somewhere it should not be.",
      },
    ],
    scenarios: [
      {
        title: "The month-end check, done first",
        steps: [
          "Open the trial balance for the month.",
          "Confirm it agrees.",
          "Scan the closing column for anything obviously wrong — a large balance on an account that is normally empty, or an account sitting on the opposite side to its neighbours.",
          "Then, and only then, go and read the statements. A statement built on a trial balance nobody checked is a guess.",
        ],
      },
      {
        title: "It does not agree",
        steps: [
          "This is rare, because every entry is checked as it posts and an unbalanced one is refused.",
          "Narrow the range — a month at a time, then a week — until the imbalance appears. The range where it first shows up contains the cause.",
          "Cross-check the journal register for that range.",
          "Statements stay blocked until it is resolved. That is deliberate: a balance sheet that does not balance is worse than no balance sheet.",
        ],
      },
    ],
    watchFor: [
      "Agreeing is not the same as being right. A trial balance agrees whenever every entry balanced, including entries that balanced perfectly on entirely the wrong accounts.",
      "Quarters and half-years run from July, not January. A \"Q1\" here is July to September.",
    ],
  },

  // ── Report ────────────────────────────────────────────────────────────────
  "accounting/statements": {
    title: "Financial statements",
    lede: "The three core statements, computed from the ledger, with last year beside this year. Nothing on this page is typed — it is the ledger, arranged the way the accounts are filed.",
    step: "report",
    connects: {
      fedBy: ["The trial balance, which must agree first"],
      feeds: ["The notes, the cash flow, Annexure-A, and the PDF of the whole set"],
    },
    reading: [
      {
        name: "Statement of Profit or Loss",
        body: "Revenue less cost of sales gives gross profit. Less administrative and selling expenses gives operating profit. Less financial expenses and tax gives the profit or loss for the period. Each subtotal is a line the company files, not a convenience.",
      },
      {
        name: "Statement of Financial Position",
        body: "What the company owns and owes on one date, in four blocks: non-current assets, current assets, shareholders' equity, current liabilities. Fixed assets are shown net — cost less depreciation charged to date. The two halves must agree, and if they do not the page says so rather than printing them.",
      },
      {
        name: "Statement of Changes in Equity",
        body: "A grid rather than a list: share capital, share money and retained earnings across the top, and the year's movements down the side. It ends where the equity block of the balance sheet begins, and the two must match.",
      },
      {
        name: "The comparative column",
        body: "The equivalent period a year earlier, on every line. It is what makes a figure mean anything — an administrative cost of four lakh is neither good nor bad until you see last year's.",
      },
      {
        name: "The period picker",
        body: "Month, quarter, half year, year, or custom. Quarters and half years run from the financial year's start month, so the first quarter is July to September. The comparative column follows whatever you choose.",
      },
      NUMBER_CONVENTIONS,
    ],
    does: [
      {
        name: "Switch between the three statements",
        body: "They share one period. Changing it on one changes it on all three, so the set always describes the same span.",
      },
      {
        name: "Change the period",
        body: "The presets cover almost every case. Custom is there for the odd request — a part-month, or a span crossing a year end.",
      },
      {
        name: "Download the PDF",
        body: "The whole set: the three statements, the cash flow, the generated notes, Annexure-A and the written policy notes, as one document, with a generation date on every page. This is what leaves the building — not a screenshot.",
      },
    ],
    scenarios: [
      {
        title: "The auditor asks for the year",
        steps: [
          "Confirm the trial balance agrees for the full financial year.",
          "Set the period to that year.",
          "Read the three statements on screen. Check the profit figure against what you expected, and check the balance sheet's two halves agree.",
          "Open the notes and skim for anything that looks unlike last year.",
          "Download the PDF and send that.",
        ],
      },
      {
        title: "The board wants to know how the half year went",
        steps: [
          "Set the period to half year and pick the first half — July to December.",
          "Read the Profit or Loss statement against its comparative column.",
          "Where a line has moved a lot, open the notes to see which account inside it moved.",
          "Take that account to the general ledger for the entries themselves.",
        ],
      },
    ],
    watchFor: [
      "Every figure here is computed. There is nothing to type and nothing to correct on this page — if a number is wrong, the entry behind it is wrong, and the ledger is where to fix it.",
      "Once a year has been closed, its Profit or Loss reads zero, because the year-end entry swept those accounts. Read a closed year before closing it, or read it through the notes and the ledger afterwards.",
      "The statements refuse to generate while the trial balance does not agree. That is the guard working, not the page failing.",
    ],
  },

  "statements/cash-flow": {
    title: "Cash flow",
    lede: "Where cash actually came from and where it went. A different question from whether the company made a profit, and frequently a different answer.",
    step: "report",
    connects: {
      fedBy: ["The Profit or Loss statement and the movement on every balance sheet account"],
      feeds: ["The PDF set"],
    },
    reading: [
      {
        name: "Operating",
        body: "Cash from running the business. It starts from the profit or loss and works towards cash, which is why the first figure is not a cash figure at all.",
      },
      {
        name: "The add-backs",
        body: "Costs that reduced profit without any money leaving — depreciation chiefly. They are added straight back, because the profit figure is not the cash figure and this is the largest reason why.",
      },
      {
        name: "Working capital movements",
        body: "Money owed to the company and by it. If customers owe more at the end of the period than the start, profit was earned but the cash has not arrived, so it comes off. If the company owes suppliers more, it has held on to cash, so it goes on.",
      },
      {
        name: "Investing",
        body: "Buying and selling long-term assets. Equipment purchases appear here, not in operating, because they are not a running cost.",
      },
      {
        name: "Financing",
        body: "Share capital paid in, loans taken and repaid.",
      },
      {
        name: "The reconciliation at the bottom",
        body: "Opening cash, plus everything above, must equal closing cash — and closing cash must equal what the balance sheet shows for cash and bank. The page checks this itself and says so if it does not.",
      },
      NUMBER_CONVENTIONS,
    ],
    does: [
      {
        name: "Choose the period",
        body: "The same control as the statements, so the two always describe the same span.",
      },
      {
        name: "Read the three sections against each other",
        body: "The shape tells the story faster than any single figure: healthy operating cash with heavy investing outflow is a company spending on itself; weak operating cash propped up by financing is a company living on its owners.",
      },
    ],
    scenarios: [
      {
        title: "A profitable month with less money in the bank",
        steps: [
          "Read the operating section: profit is positive.",
          "Look at the working capital lines — a large increase in what customers owe, unpaid.",
          "Look at investing: equipment was bought.",
          "The profit was real. The cash went into invoices nobody has paid yet and into a purchase that will be depreciated over years.",
        ],
      },
    ],
    watchFor: [
      "The reconciliation is an identity — it will almost always tie. What it proves is that everything was classified into one of the three sections, not that each item went into the right one.",
      "Depreciation shows here as an add-back only once depreciation is actually being posted. Until an asset depreciation run has been posted, this line reads nil.",
    ],
  },

  "statements/notes": {
    title: "Notes",
    lede: "The breakdowns behind the single lines on the statements, generated from the ledger. When a statement line looks wrong, this is the next page to open.",
    step: "report",
    connects: {
      fedBy: ["The same ledger balances the statements use"],
      feeds: ["The PDF set"],
    },
    reading: [
      {
        name: "One note per statement line",
        body: "Each note takes a line — administrative expenses, say — and lists the accounts that make it up, with last year beside each.",
      },
      {
        name: "The note number",
        body: "Matches the reference printed against the line on the statement itself, so a reader of the PDF can follow from one to the other.",
      },
      {
        name: "The total ties",
        body: "Every note's total equals the statement line it explains. If a note and its line disagree, one of them is being computed wrongly and it is worth reporting rather than working around.",
      },
      NUMBER_CONVENTIONS,
    ],
    does: [
      {
        name: "Read a note",
        body: "The accounts inside a statement line, this period and last.",
      },
      {
        name: "Set the period",
        body: "The same control as the statements, so the notes always match whatever is on screen there.",
      },
      {
        name: "Trace a figure onwards",
        body: "A note narrows a statement line to an account. The general ledger narrows an account to the entries. Between them any figure on any statement can be followed to the people who approved it.",
      },
    ],
    scenarios: [
      {
        title: "Administrative expenses jumped and nobody knows why",
        steps: [
          "Open the note for administrative expenses.",
          "Compare each row against its comparative column.",
          "One row has trebled.",
          "Take that account to the general ledger for the same period and read the entries behind it.",
          "Open the entry that stands out to see who approved it and what was attached.",
        ],
      },
    ],
    watchFor: [
      "A note is only as detailed as the chart of accounts. If a note is one large row called miscellaneous, the fix is to add real accounts and re-point the posting rules, not to change the note.",
    ],
  },

  "statements/annexure-a": {
    title: "Annexure-A",
    lede: "The fixed asset schedule: what the company owns, what it cost, how much has been written off, and what it is worth now. One row per asset class.",
    step: "report",
    connects: {
      fedBy: ["Asset capitalisations and depreciation runs, through the ledger"],
      feeds: ["The fixed asset figure on the Statement of Financial Position", "The PDF set"],
    },
    reading: [
      {
        name: "The cost columns",
        body: "Cost at the start of the period, anything added during it, and cost at the end. This is what was paid, and it never changes with age.",
      },
      {
        name: "The depreciation columns",
        body: "Depreciation charged before the period, charged during it, and the total charged to date.",
      },
      {
        name: "Written-down value",
        body: "Cost less depreciation to date. What the asset is carried at in the accounts — which is not what it would sell for.",
      },
      {
        name: "The rate",
        body: "Each class writes down at its own annual rate: furniture and office equipment at ten per cent, computers at twenty, software at twenty-five. The charge is on the reducing balance, so it is a percentage of what is left rather than of the original cost, and it gets smaller every year.",
      },
      {
        name: "It ties to the balance sheet",
        body: "The written-down value total equals the fixed asset figure on the Statement of Financial Position. The system refuses to produce a schedule that does not, so if you can see one, they agree.",
      },
      NUMBER_CONVENTIONS,
    ],
    does: [
      {
        name: "Read a class",
        body: "One row per asset class, with the classes taken from the chart of accounts rather than from the asset register — so the schedule shows what the ledger holds.",
      },
      {
        name: "Set the period",
        body: "The schedule is usually read for a full financial year, which is the form it is filed in.",
      },
      {
        name: "Check it against the register",
        body: "The asset register lists individual items; this lists classes. A class here that looks small against the items in the register usually means assets have been added to the register and never capitalised.",
      },
    ],
    scenarios: [
      {
        title: "Confirming the balance sheet's equipment figure",
        steps: [
          "Read the written-down value total at the bottom of the schedule.",
          "Open the Statement of Financial Position for the same period.",
          "The two figures are the same one, shown two ways — one as a single line, one broken into classes with their history.",
        ],
      },
      {
        title: "A laptop was bought and the schedule has not moved",
        steps: [
          "Check the asset register: the laptop is there.",
          "Check whether it has been capitalised. Adding an asset to the register does not post anything — capitalising it does, and that is a separate finance action.",
          "Capitalise it. The cost-added column moves in the period it was capitalised.",
          "It begins depreciating from the month it was purchased, not the month it was capitalised, so the first run after may charge several months at once.",
        ],
      },
    ],
    watchFor: [
      "Assets in the register that were never capitalised appear nowhere on this schedule. The register and the ledger are separate on purpose, and capitalising is the bridge between them.",
      "Depreciation only appears once a depreciation run has been posted for the period. A month with no run shows no charge, and the next run will catch it up.",
    ],
  },

  "statements/policy-notes": {
    title: "Policy notes",
    lede: "The written notes at the front of the accounts — how the company reports, rather than what it earned. The only part of the statements somebody writes instead of computes.",
    step: "report",
    connects: {
      fedBy: ["Nothing — this is written"],
      feeds: ["The PDF set, printed ahead of the generated notes"],
    },
    reading: [
      {
        name: "What belongs here",
        body: "Basis of preparation, the reporting framework, how revenue is recognised, how fixed assets are depreciated, how foreign currency is handled, and the company's own background. Typed once and changed rarely.",
      },
      {
        name: "The reference number",
        body: "Decides where a note appears in the printed sequence, and matches the numbering the audited accounts use.",
      },
    ],
    does: [
      {
        name: "Read and edit a note",
        body: "Title and body text. Editing takes effect on the next PDF.",
        roles: ["FINANCE_OFFICER", "SUPER_ADMIN"],
      },
      {
        name: "Add a note",
        body: "A reference, a title and its text.",
        roles: ["FINANCE_OFFICER", "SUPER_ADMIN"],
      },
      {
        name: "Reorder",
        body: "The sort order controls the printed sequence where two notes share a reference.",
        roles: ["FINANCE_OFFICER", "SUPER_ADMIN"],
      },
      {
        name: "Delete a note",
        body: "For a policy that no longer applies. There is nothing computed depending on it, so deletion is safe.",
        roles: ["FINANCE_OFFICER", "SUPER_ADMIN"],
      },
    ],
    scenarios: [
      {
        title: "The depreciation policy changes",
        steps: [
          "Open the note describing how fixed assets are depreciated.",
          "Edit the text to describe the new method and rates.",
          "Check the rates you have written match the rates actually set on the asset accounts in the chart — nothing checks this for you.",
          "It appears in the next PDF, in the same position, without anybody retyping the whole set.",
        ],
      },
    ],
    watchFor: [
      "Nothing here is checked against the ledger. If a policy note says assets depreciate at fifteen per cent and the chart says ten, the PDF will print both and neither will complain. What these notes say is your responsibility.",
      "These survive a re-seed of the chart of accounts. An edited note is not overwritten by setup being run again.",
    ],
  },

  // ── Where money enters the ledger ─────────────────────────────────────────
  payroll: {
    title: "Payroll",
    lede: "Where the largest figure in the accounts comes from. A run posts to the ledger twice: once when it is approved, once when the money leaves.",
    step: "record",
    connects: {
      fedBy: ["Salary structures", "Attendance for the month", "Adjustments HR has added", "Approved expense claims waiting to be reimbursed"],
      feeds: ["The salary and allowance expense accounts", "Salary payable", "The bank account", "Tax withheld"],
    },
    reading: [
      {
        name: "Processed",
        body: "Payslips have been built from each employee's salary structure and the month's attendance. Nothing has posted and nobody has been paid. Safe to reprocess.",
      },
      {
        name: "Approved",
        body: "A named person has signed it off, and at that moment the cost hits the books — whether or not anybody has been paid. Every salary head is charged to an expense account, and deductions and net pay are recorded as owed.",
      },
      {
        name: "Disbursed",
        body: "The money has left. A second entry clears what was owed against the bank, and any expense claims the run swept are marked reimbursed.",
      },
      {
        name: "Which expense account each head goes to",
        body: "Decided by the posting rules, from the employee's department. A department marked as direct sends its salaries to cost of sales; an administrative one sends them to administrative expenses. Nobody chooses an account while approving.",
      },
    ],
    does: [
      {
        name: "Process a run",
        body: "Builds the payslips. Read the preview — it is the last point at which everything is still freely changeable.",
      },
      {
        name: "Approve",
        body: "Signs it off and posts the cost. This is the consequential step.",
        roles: ["FINANCE_OFFICER", "SUPER_ADMIN"],
      },
      {
        name: "Disburse",
        body: "Records that the money has gone and clears the payable.",
        roles: ["FINANCE_OFFICER", "SUPER_ADMIN"],
      },
    ],
    scenarios: [
      {
        title: "July payroll, from processing to the ledger",
        steps: [
          "Process the run on the 28th and read the preview.",
          "Approve on the 29th. July's accounts now carry the salary cost, and salary payable shows what is owed.",
          "Disburse on the 1st. The bank balance drops and salary payable clears to zero.",
          "Open the general ledger on salary payable for July: it should open at nil, rise on approval, and return to nil on disbursement.",
        ],
      },
      {
        title: "Somebody was paid the wrong amount and the run is approved",
        steps: [
          "The run cannot be edited — approval is a one-way door, and the ledger has already been told.",
          "Add an adjustment for the difference on the next month's run, with a reason.",
          "Both months read correctly, and the correction is visible as a correction rather than disguised as a normal payment.",
        ],
      },
    ],
    watchFor: [
      "Approval is a one-way door. After it, corrections are a fresh adjustment, not an edit.",
      "If the accounting month is closed, disbursement is refused and the run stays approved. Nothing is left half-done — but the money will not move until the month is reopened or the disbursement is dated into an open one.",
      "The cost lands in the month the run is for, not the month it was paid. July's salaries are a July cost even when they are paid on 1 August.",
    ],
  },

  expenses: {
    title: "Expenses",
    lede: "Employee claims. Approving one records the cost; paying it clears what the company owes the employee.",
    step: "record",
    connects: {
      fedBy: ["Claims employees file, with their receipts"],
      feeds: ["The expense account its category maps to", "Reimbursements payable", "A payroll run or a final settlement, which is what pays it"],
    },
    reading: [
      {
        name: "Pending",
        body: "Filed, waiting for a decision. Nothing has posted.",
      },
      {
        name: "Approved",
        body: "The cost is in the books from the day of approval, and the company is recorded as owing the employee. The money has not moved.",
      },
      {
        name: "Reimbursed",
        body: "Paid, through a payroll run or a settlement. The claim records which one cleared it, so this status is checkable against a bank file rather than being a label somebody set.",
      },
      {
        name: "Rejected",
        body: "Nothing posts, ever. A rejected claim never touches the ledger.",
      },
    ],
    does: [
      {
        name: "Review a claim",
        body: "The amount, the category, the date, the reason and the attached receipt.",
      },
      {
        name: "Approve",
        body: "Posts the cost to the account its category maps to, and records the debt to the employee.",
        roles: ["FINANCE_OFFICER", "SUPER_ADMIN"],
      },
      {
        name: "Reject",
        body: "With a reason the claimant will read.",
        roles: ["FINANCE_OFFICER", "SUPER_ADMIN"],
      },
    ],
    scenarios: [
      {
        title: "A travel claim in August, paid in September",
        steps: [
          "The claim is approved on 20 August. August's accounts carry the travel cost from that day.",
          "It is swept into the August payroll run and paid on 1 September.",
          "August shows the cost; September shows the cash leaving. Both are true, and the reimbursements payable account is what bridges them.",
        ],
      },
    ],
    watchFor: [
      "Reimbursed is a status the system sets when a run or a settlement consumes the claim, never one a person sets by hand. If a claim looks stuck on approved, the question is which run should have swept it.",
    ],
  },

  settlements: {
    title: "Settlements",
    lede: "What someone is owed when they leave, and how each part of it reaches the books separately.",
    step: "record",
    connects: {
      fedBy: ["The employee's salary structure and last working day", "Unpaid expense claims", "Anything being recovered — an advance, or an asset not returned"],
      feeds: ["Salary, gratuity and notice pay accounts, each its own", "Final dues payable", "The bank"],
    },
    reading: [
      {
        name: "The heads",
        body: "Pending salary, gratuity, notice pay, leave encashment and outstanding expense claims, each shown separately, less anything being recovered. Each head posts to its own account, so gratuity and notice pay are visible in the accounts rather than hidden inside salaries.",
      },
      {
        name: "The frozen exchange rate",
        body: "A settlement in dollars carries the rate it was built at, and every head converts at that one rate. The rate does not move between approval and payment, so the entry balances and the payable clears exactly.",
      },
      {
        name: "Recoveries",
        body: "An advance being recovered and an asset not returned are two different things and post to two different accounts — one reduces a receivable, the other is income. Folding them together would credit an account that was never debited.",
      },
    ],
    does: [
      {
        name: "Build the settlement",
        body: "Computed from the employee's structure and last working day, with the heads shown for review before anything is committed.",
        roles: ["FINANCE_OFFICER", "SUPER_ADMIN"],
      },
      {
        name: "Add a recovery",
        body: "Anything the employee owes back. The exit checklist lists unreturned assets and any recoveries already priced against them.",
        roles: ["FINANCE_OFFICER", "SUPER_ADMIN"],
      },
      {
        name: "Approve",
        body: "Posts every head to its own account and records the final amount as owed.",
        roles: ["FINANCE_OFFICER", "SUPER_ADMIN"],
      },
      {
        name: "Pay",
        body: "Clears the payable against the bank and marks any swept expense claims reimbursed.",
        roles: ["FINANCE_OFFICER", "SUPER_ADMIN"],
      },
    ],
    scenarios: [
      {
        title: "An employee leaves owing for a laptop",
        steps: [
          "Build the settlement. Each head is listed separately and the exit checklist shows the unreturned laptop.",
          "Enter the recovery so the final figure is net of it.",
          "Approve. The accounts show the full cost of each head, and the recovery credited separately rather than quietly reducing the salary cost.",
          "Pay. The bank moves by the net figure.",
        ],
      },
    ],
    watchFor: [
      "An unreturned asset never blocks a settlement. The salary figure is right and the asset is a separate debt — naming it, pricing it and deducting it is the answer, not withholding what somebody is statutorily owed.",
    ],
  },

  costs: {
    title: "Expenses (company)",
    lede: "Rent, electricity, internet, cleaning — the running bills. Entering one records the cost and the debt; paying it moves the bank.",
    step: "record",
    connects: {
      fedBy: ["Supplier bills, entered singly or imported from a spreadsheet"],
      feeds: ["The expense account its category maps to", "Trade and other payables", "The bank"],
    },
    reading: [
      {
        name: "The period a bill relates to",
        body: "Separate from the date it was entered. July's electricity bill relates to July however late it arrives, and the period is what reports group it by.",
      },
      {
        name: "The ledger date",
        body: "When it was entered, not the period it relates to. A July bill arriving on 5 August posts into August, because dating it into July would be refused by a closed month essentially every month.",
      },
      {
        name: "Commitments",
        body: "A recurring bill — monthly rent, say — recorded once so the system can tell you when this month's has not arrived. A commitment is not a bill and posts nothing itself.",
      },
    ],
    does: [
      {
        name: "Record a bill",
        body: "Category, payee, amount, and the month it relates to. Recording it posts the cost and the payable.",
        roles: ["FINANCE_OFFICER", "SUPER_ADMIN"],
      },
      {
        name: "Correct a bill",
        body: "Possible until a journal has been posted from it, after which the figures it was built from are refused and the refusal names the entry. A misspelt payee can still be fixed at any time — it only ever reached the ledger as narration.",
        roles: ["FINANCE_OFFICER", "SUPER_ADMIN"],
      },
      {
        name: "Pay a bill",
        body: "Clears the payable against the bank.",
        roles: ["FINANCE_OFFICER", "SUPER_ADMIN"],
      },
      {
        name: "Track a commitment",
        body: "So a missing bill is noticed rather than discovered at year end.",
        roles: ["FINANCE_OFFICER", "SUPER_ADMIN"],
      },
      {
        name: "Import in bulk",
        body: "A spreadsheet of bills, with a per-row preview that writes nothing until you accept it. The commit is all or nothing — a file with one bad row imports no rows.",
        roles: ["FINANCE_OFFICER", "SUPER_ADMIN"],
      },
    ],
    scenarios: [
      {
        title: "July's electricity bill arrives on 5 August",
        steps: [
          "Record it with July as the period it relates to.",
          "The ledger entry is dated 5 August, because July may well be closed.",
          "Cost reports grouped by period still show it as a July cost.",
          "Pay it, and the payable clears.",
        ],
      },
      {
        title: "The rent bill has not arrived",
        steps: [
          "The commitment for monthly rent flags the month as missing.",
          "Either the bill is late, or it was paid and never recorded.",
          "If the cost genuinely belongs to a month that is closing, accrue it with a hand-typed journal and reverse the accrual when the real bill arrives.",
        ],
      },
    ],
    watchFor: [
      "Bills in foreign currency are refused. Company expenses do not freeze an exchange rate, so the bill and the payment would convert at different rates and leave a residue on the payables account that never clears and that no account exists to absorb. Record it in taka.",
      "Editing a bill after it has posted is refused for the figures the entry was built from — the amount, the category and the currency. Correcting those is a reversal.",
    ],
  },
}

const ROLE_SEGMENTS = new Set(["admin", "finance", "hr", "manager", "employee"])

/**
 * The same page exists under several role prefixes, so the first segment is
 * dropped and the rest matched longest-first. A journal detail page has no
 * entry of its own and falls back to the register's, which is the right answer
 * rather than a missing one.
 *
 * Returns null for every page outside the accounting section, and the trigger
 * hides itself when it does — a help button that opens an apology is worse
 * than no help button.
 */
export function helpKeyFor(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean)
  if (parts.length > 0 && ROLE_SEGMENTS.has(parts[0])) parts.shift()

  for (let i = parts.length; i > 0; i--) {
    const key = parts.slice(0, i).join("/")
    if (key in HELP) return key
  }
  return null
}
