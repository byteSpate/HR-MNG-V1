"use client"

import { RiAlertLine } from "@remixicon/react"

import type { ProjectSummary } from "@/lib/api/types"
import {
  countText, dayText, daysLeftText, HEALTH_LABEL, HEALTH_TONE, linesDone, nextMilestone, quietText,
} from "@/lib/project-overview"
import { TONE } from "@/components/dashboard/record-kit"
import { Tag } from "@/components/dashboard/tag"
import { Panel, PanelHeading } from "@/components/sales/shared/panel"
import { PROJECT_STATUS_LABEL } from "@/components/sales/projects/project-shared"
import { taka } from "@/components/sales/shared/sales-shared"

const money = (value: string | null) => (value === null ? "Not set" : taka(value))

function Bar({ percent, label }: { percent: number; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-1.5 w-full rounded-full bg-line"
    >
      <div className="h-full rounded-full bg-ink" style={{ width: `${percent}%` }} />
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <dt className={`text-caption ${TONE.muted}`}>{label}</dt>
      <dd className="text-body-sm font-semibold [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

/**
 * One screen for one Project (spec 2026-09-30): how it is going, what is
 * happening right now, who has what, what has been delivered, and the money.
 * Everything here comes from the Project the page already loaded, and the
 * health, days left and quiet days come from the server, so this tab and the
 * Projects list always agree. Nothing on it can be edited: the other tabs do
 * that.
 */
export function ProjectOverviewTab({ project }: { project: ProjectSummary }) {
  const quiet = quietText(project.quietDays)
  const next = nextMilestone(project.milestones)
  const { done, total } = linesDone(project.lines)
  const isSoftware = project.opportunity.track === "SOFTWARE_DEVELOPMENT"
  const noun = isSoftware ? "Modules" : "Products"
  const oneNoun = isSoftware ? "module" : "product"
  const log = project.latestLog

  return (
    <div className="grid gap-4">
      {quiet ? (
        <p className="flex items-start gap-1.5 rounded-md border border-warning-line bg-warning-tint px-3 py-2 text-caption leading-relaxed text-warning">
          <RiAlertLine className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {quiet}. Nobody has written a Daily Log line, changed a task or ticked anything. Ask the Project Manager
            for an update.
          </span>
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeading title="How it is going" />
          <div className="flex flex-wrap items-center gap-2.5">
            {project.health ? (
              <Tag label={HEALTH_LABEL[project.health]} tone={HEALTH_TONE[project.health]} />
            ) : (
              <span className={`text-caption ${TONE.muted}`}>No health to show yet</span>
            )}
            <span
              className={`text-body-sm font-semibold ${project.daysLeft !== null && project.daysLeft < 0 ? "text-danger" : ""}`}
            >
              {daysLeftText(project.daysLeft, project.status)}
            </span>
            {/* With no date the days-left words already say "No finish date". */}
            {project.dueOn ? <span className={`text-caption ${TONE.muted}`}>Finish date {dayText(project.dueOn)}</span> : null}
          </div>
          <div className="mt-3">
            {project.progress ? (
              <>
                <Bar percent={project.progress.percent} label="Tasks done" />
                <div className={`mt-1.5 text-caption ${TONE.muted}`}>
                  {project.progress.done} of {countText(project.progress.total, "task")} done ({project.progress.percent}%)
                </div>
              </>
            ) : (
              <div className={`text-caption ${TONE.muted}`}>No tasks yet, so there is no progress to show.</div>
            )}
          </div>
          <div className="mt-2 text-caption">{countText(project.openTaskCount, "open task")}</div>
        </Panel>

        <Panel>
          <PanelHeading title="Right now" />
          <dl className="divide-y divide-line">
            <Row label="Status">
              {PROJECT_STATUS_LABEL[project.status]}
              {project.statusReason ? (
                <span className={`block text-caption font-normal ${TONE.muted}`}>{project.statusReason}</span>
              ) : null}
            </Row>
            <Row label="Next milestone">
              {next ? (
                <>
                  {next.title}
                  <span className={`block text-caption font-normal ${TONE.muted}`}>Due {dayText(next.dueOn)}</span>
                </>
              ) : (
                <span className={`font-normal ${TONE.muted}`}>
                  {project.milestones.length === 0 ? "No milestones yet" : "All milestones are done"}
                </span>
              )}
            </Row>
            <Row label="Latest Daily Log line">
              {log ? (
                <>
                  {log.noWork ? "No work on this day" : log.text}
                  <span className={`block text-caption font-normal ${TONE.muted}`}>
                    {log.byName ?? "Someone"} · {dayText(log.date)}
                  </span>
                </>
              ) : (
                <span className={`font-normal ${TONE.muted}`}>No Daily Log line yet</span>
              )}
            </Row>
          </dl>
        </Panel>

        <Panel>
          <PanelHeading title="People" />
          <ul className="divide-y divide-line">
            {project.people.map((person) => (
              <li key={person.employeeId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-body-sm">
                <span className="font-semibold">{person.fullName}</span>
                <span className={TONE.muted}>
                  {person.open} open
                  {person.late > 0 ? <span className="font-semibold text-danger"> · {person.late} late</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel>
          <PanelHeading title={`${noun} delivered`} />
          {total === 0 ? (
            <div className={`text-caption ${TONE.muted}`}>The Opportunity has no {noun.toLowerCase()} yet.</div>
          ) : (
            <>
              <Bar percent={Math.round((done / total) * 100)} label={`${noun} delivered`} />
              <div className="mt-1.5 text-caption">
                {done} of {countText(total, oneNoun)} done
              </div>
            </>
          )}
        </Panel>
      </div>

      <Panel>
        <PanelHeading title="Money" />
        <dl className="divide-y divide-line">
          <Row label="Opportunity value">{money(project.value)}</Row>
          <Row label="Budget">{money(project.budget)}</Row>
          <Row label="Planned cost">{money(project.plannedCost)}</Row>
          {/* Only Finance and Super Admin are sent the spend. Everyone else sees
              no row at all, not a placeholder that hints at a hidden number. */}
          {project.canSeeCost ? <Row label="Spent so far">{money(project.spentSoFar)}</Row> : null}
        </dl>
      </Panel>
    </div>
  )
}
