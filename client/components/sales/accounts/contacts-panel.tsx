"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiErrorWarningLine, RiMailLine, RiPhoneLine, RiStarFill, RiStarLine } from "@remixicon/react"

import { addContact, listContacts, setContactStatus, setPrimaryContact, updateContact } from "@/lib/api/sales/accounts"
import { useSession } from "@/lib/auth/session-context"
import type {
  CreateSalesContactBody, SalesContactSummary, UpdateSalesContactBody,
} from "@/lib/api/types"
import { CONTACT_STATUS_LABEL, CONTACT_STATUS_TONE } from "@/components/sales/shared/sales-shared"
import { DialogActions, Field, FormError, RowActions, toMessage } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tag } from "@/components/dashboard/tag"
import { Panel, PanelError, PanelHeading, PanelSkeleton } from "@/components/sales/shared/panel"

function ContactRow({
  contact,
  onEdit,
  onMakePrimary,
  onVerify,
  pending,
  canManage,
  delayMs,
}: {
  contact: SalesContactSummary
  onEdit: () => void
  onMakePrimary: () => void
  onVerify: () => void
  pending: boolean
  canManage: boolean
  delayMs: number
}) {
  const actions = canManage
    ? [
        { kind: "edit" as const, label: "Edit", onClick: onEdit },
        ...(contact.isPrimary
          ? []
          : [{ kind: "custom" as const, label: "Make primary", icon: <RiStarLine className="size-3.5" aria-hidden />, onClick: onMakePrimary }]),
        ...(contact.status === "VERIFIED"
          ? []
          : [{ kind: "custom" as const, label: "Verify", icon: <RiPhoneLine className="size-3.5" aria-hidden />, onClick: onVerify }]),
      ]
    : []

  return (
    <li className="rise-in border-b border-[#EEF1F5] py-3 last:border-b-0" style={{ animationDelay: `${delayMs}ms` }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {contact.isPrimary ? (
              <RiStarFill className="size-3.5 shrink-0 text-[#C79A2E]" aria-hidden />
            ) : null}
            <span className="truncate text-[13px] font-semibold">{contact.name}</span>
          </div>
          {contact.designation ? (
            <div className="truncate text-[11.5px] text-[#6B7789]">{contact.designation}</div>
          ) : null}
          <div className="mt-1 space-y-0.5">
            {contact.phone ? (
              <div className="flex items-center gap-1.5 text-[12px] text-[#3D4756]">
                <RiPhoneLine className="size-3 shrink-0 text-[#8A94A2]" aria-hidden />
                {contact.phone}
              </div>
            ) : null}
            {contact.email ? (
              <div className="flex items-center gap-1.5 text-[12px] text-[#3D4756]">
                <RiMailLine className="size-3 shrink-0 text-[#8A94A2]" aria-hidden />
                {contact.email}
              </div>
            ) : null}
          </div>
        </div>
        <Tag label={CONTACT_STATUS_LABEL[contact.status]} tone={CONTACT_STATUS_TONE[contact.status]} />
      </div>
      {actions.length > 0 ? (
        <div className="mt-1.5">
          <RowActions actions={pending ? [] : actions} />
        </div>
      ) : null}
    </li>
  )
}

export function ContactsPanel({ accountId, canManage }: { accountId: string; canManage: boolean }) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [editingContact, setEditingContact] = useState<SalesContactSummary | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [pendingContactId, setPendingContactId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [designation, setDesignation] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")

  const contactsQuery = useQuery({
    queryKey: ["sales", "accounts", accountId, "contacts"],
    queryFn: () => listContacts(accessToken!, accountId),
    enabled: !!accessToken,
  })

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["sales", "accounts", accountId, "contacts"] })
    queryClient.invalidateQueries({ queryKey: ["sales", "accounts", accountId, "history"] })
    queryClient.invalidateQueries({ queryKey: ["sales", "dashboard"] })
  }

  const addMutation = useMutation({
    mutationFn: (body: CreateSalesContactBody) => addContact(accessToken!, accountId, body),
    onSuccess: () => {
      setAddOpen(false)
      invalidate()
    },
    onError: (err) => setFormError(toMessage(err)),
  })

  const editMutation = useMutation({
    mutationFn: (body: UpdateSalesContactBody) => updateContact(accessToken!, editingContact!.id, body),
    onSuccess: () => {
      setEditingContact(null)
      invalidate()
    },
    onError: (err) => setFormError(toMessage(err)),
  })

  // Both row actions report failure the same way, in the panel rather than
  // the dialog: they are fired from a row, not a form, so there is no open
  // surface to put a message on. Without this a server refusal — a contact
  // deleted underneath you, access revoked mid-session — simply left the row
  // unchanged, which is indistinguishable from nothing having happened.
  const rowMutationOptions = {
    onMutate: (contactId: string) => {
      setRowError(null)
      setPendingContactId(contactId)
    },
    onSettled: () => setPendingContactId(null),
    onSuccess: () => {
      invalidate()
    },
    onError: (err: unknown) => setRowError(toMessage(err)),
  }

  const primaryMutation = useMutation({
    mutationFn: (contactId: string) => setPrimaryContact(accessToken!, contactId),
    ...rowMutationOptions,
  })

  const verifyMutation = useMutation({
    mutationFn: (contactId: string) => setContactStatus(accessToken!, contactId, { status: "VERIFIED" }),
    ...rowMutationOptions,
  })

  function resetForm() {
    setName("")
    setDesignation("")
    setPhone("")
    setEmail("")
    setFormError(null)
  }

  function openEdit(contact: SalesContactSummary) {
    setFormError(null)
    setName(contact.name)
    setDesignation(contact.designation ?? "")
    setPhone(contact.phone ?? "")
    setEmail(contact.email ?? "")
    setEditingContact(contact)
  }

  // Shared by Add and Edit: a contact nobody can contact is just a name in a
  // list. Mirrors createSalesContactSchema's own rule server-side.
  function validateFields(): string | null {
    if (!name.trim()) return "A contact needs a name."
    if (!phone.trim() && !email.trim()) {
      return "Add a phone number or an email — a contact needs at least one way to reach them."
    }
    return null
  }

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    setFormError(null)
    const error = validateFields()
    if (error) {
      setFormError(error)
      return
    }
    addMutation.mutate({
      name: name.trim(),
      designation: designation.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
    })
  }

  function handleEditSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    setFormError(null)
    const error = validateFields()
    if (error) {
      setFormError(error)
      return
    }
    editMutation.mutate({
      name: name.trim(),
      designation: designation.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
    })
  }

  if (contactsQuery.isPending) return <PanelSkeleton />
  if (contactsQuery.isError) return <PanelError onRetry={() => contactsQuery.refetch()} />

  const contacts = contactsQuery.data ?? []
  const noneVerified = contacts.length > 0 && !contacts.some((c) => c.status === "VERIFIED")

  return (
    <Panel>
      <PanelHeading
        title="Contacts"
        action={
          canManage ? (
            <Button
              onClick={() => {
                resetForm()
                setAddOpen(true)
              }}
              className="h-auto rounded-md bg-[#17191C] px-2.5 py-1.5 text-[12px] font-bold text-white hover:bg-[#0E1012]"
            >
              Add
            </Button>
          ) : undefined
        }
      />

      {/* The server's own sentence, shown as written — its refusals carry
          counts and names the client does not have. */}
      {rowError ? (
        <p
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-md border border-[#F0D2D2] bg-[#FDF6F6] px-3 py-2 text-[12px] leading-relaxed font-semibold text-[#B03A3A]"
        >
          <RiErrorWarningLine className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{rowError}</span>
        </p>
      ) : null}

      {noneVerified ? (
        <p className="mb-3 rounded-md border border-[#F5E0BE] bg-[#FDF8EE] px-3 py-2 text-[12px] leading-relaxed text-[#8A5E0C]">
          Nobody on this account has been reached yet.
        </p>
      ) : null}

      {contacts.length === 0 ? (
        <p className="py-4 text-center text-[12.5px] text-[#5F6B7C]">
          {canManage ? "No contacts yet. Add the first person here." : "No contacts yet."}
        </p>
      ) : (
        <ul>
          {contacts.map((c, i) => (
            <ContactRow
              key={c.id}
              contact={c}
              pending={pendingContactId === c.id}
              canManage={canManage}
              delayMs={Math.min(i, 8) * 24}
              onEdit={() => openEdit(c)}
              onMakePrimary={() => primaryMutation.mutate(c.id)}
              onVerify={() => verifyMutation.mutate(c.id)}
            />
          ))}
        </ul>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a contact</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Name" htmlFor="contact-name">
              <Input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Designation" htmlFor="contact-designation" hint="Optional." help="Their job title, like Procurement Manager.">
              <Input id="contact-designation" value={designation} onChange={(e) => setDesignation(e.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Phone" htmlFor="contact-phone">
                <Input id="contact-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
              <Field label="Email" htmlFor="contact-email">
                <Input id="contact-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
            </div>
            {/* One hint under the pair rather than "Optional." under each:
                either will do, but one of them is required, and that is a
                fact about the pair. */}
            <p className="-mt-2 text-[11.5px] leading-relaxed text-[#5F6B7C]">
              Give at least one: a phone number or an email. Without one there is no way to
              reach this person.
            </p>
            {formError ? <FormError>{formError}</FormError> : null}
            <DialogFooter>
              <DialogActions
                pending={addMutation.isPending}
                submitLabel="Add contact"
                disabled={false}
                onCancel={() => setAddOpen(false)}
                onSubmit={() => handleSubmit()}
              />
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editingContact !== null} onOpenChange={(open) => !open && setEditingContact(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editingContact?.name ?? "contact"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <Field label="Name" htmlFor="contact-edit-name">
              <Input id="contact-edit-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Designation" htmlFor="contact-edit-designation" hint="Optional." help="Their job title, like Procurement Manager.">
              <Input id="contact-edit-designation" value={designation} onChange={(e) => setDesignation(e.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Phone" htmlFor="contact-edit-phone">
                <Input id="contact-edit-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
              <Field label="Email" htmlFor="contact-edit-email">
                <Input id="contact-edit-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
            </div>
            <p className="-mt-2 text-[11.5px] leading-relaxed text-[#5F6B7C]">
              Give at least one: a phone number or an email. Without one there is no way to
              reach this person.
            </p>
            {formError ? <FormError>{formError}</FormError> : null}
            <DialogFooter>
              <DialogActions
                pending={editMutation.isPending}
                submitLabel="Save changes"
                disabled={false}
                onCancel={() => setEditingContact(null)}
                onSubmit={() => handleEditSubmit()}
              />
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}
