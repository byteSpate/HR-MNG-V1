"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  listSalesEligibleEmployees,
  updateSalesAccount,
} from "@/lib/api/sales";
import { salesKeys } from "@/lib/api/sales-keys";
import { useSession } from "@/lib/auth/session-context";
import type {
  SalesAccountStatus,
  SalesAccountSummary,
  UpdateSalesAccountBody,
} from "@/lib/api/types";
import {
  DialogActions,
  Field,
  FormError,
  PanelAlert,
  TONE,
  toMessage,
} from "@/components/dashboard/record-kit";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ACCOUNT_STATUS_LABEL } from "@/components/sales/sales-shared";

const STATUSES: SalesAccountStatus[] = ["ACTIVE", "INACTIVE", "DO_NOT_CONTACT"];

/**
 * Editing an account, including the one operation that was missing entirely:
 * giving it a new owner.
 *
 * Phase 1 could create an account and read it and nothing else, so an account
 * whose owner had left was flagged as needing a new owner with no way to give
 * it one — the interface stated a problem it could not solve. This is what
 * that flag now links to.
 *
 * Only changed fields are sent. The server distinguishes absent from null, so
 * posting the whole form would clear fields nobody touched.
 */
export function AccountEditDialog({
  account,
  open,
  onOpenChange,
  focusOwner = false,
}: {
  account: SalesAccountSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opened from the "needs a new owner" flag, so the reason is already known. */
  focusOwner?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {focusOwner
              ? "Give this account a new owner"
              : "Edit Sales Account"}
          </DialogTitle>
        </DialogHeader>
        {/*
          Mounted only while open, and keyed by the record it edits, so every
          field starts from what is stored. Remounting rather than syncing in
          an effect: a cancelled edit leaves no draft to reappear later, and
          there is no effect racing the props it copies from.
        */}
        {open ? (
          <EditAccountForm
            key={account.id}
            account={account}
            focusOwner={focusOwner}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EditAccountForm({
  account,
  focusOwner,
  onDone,
}: {
  account: SalesAccountSummary;
  focusOwner: boolean;
  onDone: () => void;
}) {
  const { accessToken, status: sessionStatus } = useSession();
  const queryClient = useQueryClient();

  const [name, setName] = useState(account.name);
  const [industry, setIndustry] = useState(account.industry ?? "");
  const [website, setWebsite] = useState(account.website ?? "");
  const [address, setAddress] = useState(account.address ?? "");
  const [ownerEmployeeId, setOwnerEmployeeId] = useState(
    account.ownerEmployeeId,
  );
  const [status, setStatus] = useState<SalesAccountStatus>(account.status);
  const [statusReason, setStatusReason] = useState(account.statusReason ?? "");
  const [error, setError] = useState<string | null>(null);

  const isAuthed = sessionStatus === "authenticated" && !!accessToken;

  // Sales Users who still hold hub access — the same list the create form
  // offers. Reassigning to somebody ineligible is refused by the server, and
  // its sentence says which of the four reasons applies.
  const eligibleQuery = useQuery({
    queryKey: ["sales", "eligible-employees"],
    queryFn: () => listSalesEligibleEmployees(accessToken!),
    enabled: isAuthed,
  });
  const employees = eligibleQuery.data ?? [];

  const save = useMutation({
    mutationFn: (body: UpdateSalesAccountBody) =>
      updateSalesAccount(accessToken!, account.id, body),
    onSuccess: () => {
      onDone();
      queryClient.invalidateQueries({
        queryKey: salesKeys.account(account.id),
      });
      queryClient.invalidateQueries({
        queryKey: salesKeys.accountHistory(account.id),
      });
      queryClient.invalidateQueries({
        queryKey: salesKeys.accountTimeline(account.id),
      });
      queryClient.invalidateQueries({ queryKey: ["sales", "accounts"] });
      queryClient.invalidateQueries({ queryKey: ["sales", "dashboard"] });
    },
    // Verbatim: the refusal names the person and which rule they fail.
    onError: (err) => setError(toMessage(err)),
  });

  const leavingActive = status !== "ACTIVE";

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("A Sales Account needs a name.");
      return;
    }
    // Checked here as well as on the server, so the answer arrives before a
    // round trip rather than after one.
    if (leavingActive && !statusReason.trim()) {
      setError(
        `Say why ${account.name} is being marked ${ACCOUNT_STATUS_LABEL[status]}. The reason is shown beside the status.`,
      );
      return;
    }

    // Only what actually changed. Absent leaves a field alone; null clears
    // it, and posting the whole form would clear what nobody touched.
    const body: UpdateSalesAccountBody = {};
    const text = (next: string, current: string | null) => {
      const trimmed = next.trim();
      const now = trimmed === "" ? null : trimmed;
      return now === (current ?? null) ? undefined : now;
    };

    if (name.trim() !== account.name) body.name = name.trim();
    const nextIndustry = text(industry, account.industry);
    if (nextIndustry !== undefined) body.industry = nextIndustry;
    const nextWebsite = text(website, account.website);
    if (nextWebsite !== undefined) body.website = nextWebsite;
    const nextAddress = text(address, account.address);
    if (nextAddress !== undefined) body.address = nextAddress;
    if (ownerEmployeeId !== account.ownerEmployeeId)
      body.ownerEmployeeId = ownerEmployeeId;
    if (status !== account.status) body.status = status;
    if (leavingActive && statusReason.trim() !== (account.statusReason ?? "")) {
      body.statusReason = statusReason.trim();
    }

    if (Object.keys(body).length === 0) {
      setError("Nothing was changed.");
      return;
    }
    save.mutate(body);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {focusOwner ? (
        <p className={`text-[12.5px] leading-relaxed ${TONE.muted}`}>
          {account.ownerName} can no longer work this account. Choosing a new
          owner is the only thing that clears the flag — nothing else about the
          account has to change.
        </p>
      ) : null}

      {eligibleQuery.isError ? (
        <PanelAlert>
          <span className="flex flex-wrap items-center gap-2">
            <span>{toMessage(eligibleQuery.error)}</span>
            <Button
              type="button"
              variant="link"
              onClick={() => eligibleQuery.refetch()}
              className="h-auto p-0 text-[12px] font-bold text-[#B03A3A] underline"
            >
              Try again
            </Button>
          </span>
        </PanelAlert>
      ) : null}

      <Field
        label="Owner"
        help="Answerable for this account. Sales Users only — a Sales Admin manages the hub rather than owning accounts in it."
        hint={
          eligibleQuery.isPending
            ? "Loading the people who can own an account…"
            : eligibleQuery.isError
              ? "This list could not be loaded, so the owner cannot be changed yet."
              : employees.length === 0
                ? "No Sales User is available. Hub access is granted from an employee's record, and only Sales Users can own an account."
                : undefined
        }
      >
        <Select
          value={ownerEmployeeId}
          onValueChange={(v) => setOwnerEmployeeId(v ?? "")}
          disabled={eligibleQuery.isPending || eligibleQuery.isError || employees.length === 0}
        >
          <SelectTrigger className="w-full">
            <SelectValue>
              {(v: string | null) =>
                employees.find((e) => e.id === v)?.fullName ??
                // The current owner may no longer be eligible, so they are
                // not in the list. Showing their name rather than an empty
                // control keeps "who owns it now" answerable.
                (v === account.ownerEmployeeId
                  ? account.ownerName
                  : "Select an owner")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {employees.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.fullName} — {e.designation}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Name" htmlFor="sa-edit-name">
        <Input
          id="sa-edit-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Industry"
          htmlFor="sa-edit-industry"
          hint="Optional." help="Clear it to remove it."
        >
          <Input
            id="sa-edit-industry"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
          />
        </Field>
        <Field
          label="Website"
          htmlFor="sa-edit-website"
          hint="Optional." help="Clear it to remove it."
        >
          <Input
            id="sa-edit-website"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </Field>
      </div>

      <Field
        label="Address"
        htmlFor="sa-edit-address"
        hint="Optional." help="Clear it to remove it."
      >
        <Input
          id="sa-edit-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </Field>

      <Field
        label="Status"
        help="Do not contact suppresses every reminder without deleting a word of the history."
      >
        <Select
          value={status}
          onValueChange={(v) =>
            setStatus((v ?? "ACTIVE") as SalesAccountStatus)
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue>
              {(v: string | null) =>
                ACCOUNT_STATUS_LABEL[(v ?? "ACTIVE") as SalesAccountStatus]
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {ACCOUNT_STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {/* Required whenever the account is not Active, and cleared by the
              server on the way back — a reason left on a reactivated account
              reads as a live warning about one nobody is warning you about. */}
      {leavingActive ? (
        <Field
          label="Reason"
          htmlFor="sa-edit-reason"
          help="Shown beside the status, so whoever opens this next knows what happened."
        >
          <Input
            id="sa-edit-reason"
            value={statusReason}
            onChange={(e) => setStatusReason(e.target.value)}
          />
        </Field>
      ) : null}

      {error ? <FormError>{error}</FormError> : null}

      <DialogFooter>
        <DialogActions
          pending={save.isPending}
          submitLabel="Save changes"
          disabled={false}
          onCancel={onDone}
          onSubmit={() => handleSubmit()}
        />
      </DialogFooter>
    </form>
  );
}
