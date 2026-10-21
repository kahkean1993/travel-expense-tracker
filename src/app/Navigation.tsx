import { useState, type ComponentType, type ReactNode, type SVGProps } from 'react'
import { href, paths } from './router'
import type { Section } from './sections'
import {
  IconChart,
  IconDots,
  IconList,
  IconPencil,
  IconPlus,
  IconReport,
  IconSettings,
  IconSuitcase,
  IconUsers,
} from '../components/Icons'
import { Sheet } from '../components/ui'
import { buttonClass } from '../components/styles'

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { title?: string }>

// ---------- Mobile bottom bar ----------

function Tab({ to, label, Icon, active }: { to: string; label: string; Icon: IconComponent; active: boolean }) {
  return (
    <li>
      <a
        href={href(to)}
        aria-current={active ? 'page' : undefined}
        className={`press flex min-h-16 flex-col items-center justify-center gap-0.5 text-[11px] ${
          active ? 'font-semibold text-accent-800' : 'text-slate-600'
        }`}
      >
        <span
          className={`flex h-7 w-14 items-center justify-center rounded-full transition-colors duration-200 ${
            active ? 'bg-accent-100' : ''
          }`}
        >
          <Icon width={21} height={21} />
        </span>
        {label}
      </a>
    </li>
  )
}

function CentreAction({ to, label, hint }: { to: string; label: string; hint: string }) {
  return (
    <li>
      <a href={href(to)} aria-label={label} className="press flex min-h-16 flex-col items-center justify-end gap-0.5 pb-1.5 text-[11px] font-semibold text-accent-800">
        <span className="-mt-5 flex size-14 items-center justify-center rounded-full bg-accent-700 text-white shadow-raised ring-4 ring-white">
          <IconPlus width={26} height={26} />
        </span>
        <span aria-hidden="true">{hint}</span>
      </a>
    </li>
  )
}

export function BottomBar({ tripId, section }: { tripId: string | null; section: Section }) {
  const [moreOpen, setMoreOpen] = useState(false)
  return (
    <>
      <nav
        aria-label="Main"
        className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/70 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {tripId ? (
          <ul className="mx-auto grid max-w-lg grid-cols-5 px-1">
            <Tab to={paths.dashboard(tripId)} label="Home" Icon={IconChart} active={section === 'home'} />
            <Tab to={paths.expenses(tripId)} label="Expenses" Icon={IconList} active={section === 'expenses'} />
            <CentreAction to={paths.expenseNew(tripId)} label="Add expense" hint="Add" />
            <Tab to={paths.travellers(tripId)} label="Split" Icon={IconUsers} active={section === 'split'} />
            <li>
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                aria-haspopup="dialog"
                className={`press flex min-h-16 w-full flex-col items-center justify-center gap-0.5 text-[11px] ${
                  section === 'more' ? 'font-semibold text-accent-800' : 'text-slate-600'
                }`}
              >
                <span className={`flex h-7 w-14 items-center justify-center rounded-full transition-colors duration-200 ${section === 'more' ? 'bg-accent-100' : ''}`}>
                  <IconDots width={21} height={21} />
                </span>
                More
              </button>
            </li>
          </ul>
        ) : (
          <ul className="mx-auto grid max-w-lg grid-cols-3 px-1">
            <Tab to={paths.trips()} label="Trips" Icon={IconSuitcase} active={section === 'trips'} />
            <CentreAction to={paths.tripNew()} label="New trip" hint="New trip" />
            <Tab to={paths.settings()} label="Settings" Icon={IconSettings} active={section === 'settings'} />
          </ul>
        )}
      </nav>
      {tripId ? (
        <Sheet open={moreOpen} title="More" onClose={() => setMoreOpen(false)}>
          <ul className="-mx-2 divide-y divide-slate-100">
            <SheetLink to={paths.trips()} Icon={IconSuitcase} title="All trips" hint="Switch or start a trip" onPick={() => setMoreOpen(false)} />
            <SheetLink to={paths.report(tripId)} Icon={IconReport} title="Report & export" hint="Print, PDF and CSV" onPick={() => setMoreOpen(false)} />
            <SheetLink to={paths.tripEdit(tripId)} Icon={IconPencil} title="Edit trip" hint="Name, dates and budget" onPick={() => setMoreOpen(false)} />
            <SheetLink to={paths.settings()} Icon={IconSettings} title="Backup & settings" hint="Backup, restore and sharing account" onPick={() => setMoreOpen(false)} />
          </ul>
        </Sheet>
      ) : null}
    </>
  )
}

function SheetLink({ to, Icon, title, hint, onPick }: { to: string; Icon: IconComponent; title: string; hint: string; onPick: () => void }) {
  return (
    <li>
      <a href={href(to)} onClick={onPick} className="press flex min-h-14 items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-50">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-700" aria-hidden="true">
          <Icon width={20} height={20} />
        </span>
        <span className="min-w-0">
          <span className="block font-medium text-slate-900">{title}</span>
          <span className="block text-sm text-slate-500">{hint}</span>
        </span>
      </a>
    </li>
  )
}

// ---------- Desktop sidebar ----------

function SideLink({ to, label, Icon, active }: { to: string; label: string; Icon: IconComponent; active: boolean }) {
  return (
    <a
      href={href(to)}
      aria-current={active ? 'page' : undefined}
      className={`press flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm ${
        active ? 'bg-accent-50 font-semibold text-accent-800' : 'text-slate-700 hover:bg-slate-100'
      }`}
    >
      <Icon width={18} height={18} />
      {label}
    </a>
  )
}

export function Sidebar({ tripId, tripName, section, footer }: { tripId: string | null; tripName: string | undefined; section: Section; footer: ReactNode }) {
  return (
    <aside className="no-print sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-slate-200/70 bg-white md:flex">
      <a href={href(paths.trips())} className="flex items-center gap-2.5 px-5 py-5 font-semibold text-slate-900">
        <span className="flex size-9 items-center justify-center rounded-xl bg-accent-700 text-white">
          <IconSuitcase width={18} height={18} />
        </span>
        Trip Expenses
      </a>
      {tripId && tripName ? (
        <div className="mx-4 mb-2 rounded-xl bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Current trip</p>
          <p className="truncate text-sm font-medium text-slate-900" title={tripName}>
            {tripName}
          </p>
        </div>
      ) : null}
      <nav aria-label="Main" className="flex flex-col gap-0.5 px-3">
        {tripId ? (
          <>
            <SideLink to={paths.dashboard(tripId)} label="Dashboard" Icon={IconChart} active={section === 'home'} />
            <SideLink to={paths.expenses(tripId)} label="Expenses" Icon={IconList} active={section === 'expenses'} />
            <SideLink to={paths.travellers(tripId)} label="Travellers & Split" Icon={IconUsers} active={section === 'split'} />
            <SideLink to={paths.report(tripId)} label="Report" Icon={IconReport} active={false} />
          </>
        ) : null}
        <SideLink to={paths.trips()} label="All trips" Icon={IconSuitcase} active={section === 'trips'} />
        <SideLink to={paths.settings()} label="Settings & Backup" Icon={IconSettings} active={section === 'settings'} />
      </nav>
      <div className="mt-4 px-4">
        <a href={href(tripId ? paths.expenseNew(tripId) : paths.tripNew())} className={buttonClass('primary', 'w-full')}>
          <IconPlus width={18} height={18} /> {tripId ? 'Add expense' : 'New trip'}
        </a>
      </div>
      <div className="mt-auto px-5 py-4 text-xs text-slate-500">{footer}</div>
    </aside>
  )
}
