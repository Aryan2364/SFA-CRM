"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import {
  CheckIcon,
  CircleAlertIcon,
  DownloadIcon,
  EyeIcon,
  FilterIcon,
  IndianRupeeIcon,
  OctagonXIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  TriangleAlertIcon,
} from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Banner,
  BannerAction,
  BannerDescription,
  BannerTitle,
} from "@/components/ui/banner"
import { CategoryBarChart } from "@/components/ui/bar-chart"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Clamp, Truncate } from "@/components/ui/truncate"
import { DatePicker } from "@/components/ui/date-picker"
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { EmptyState } from "@/components/ui/empty-state"
import { InlineFieldError } from "@/components/ui/inline-field-error"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import {
  Pagination,
  PaginationBar,
  PaginationContent,
  PaginationCount,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { PasswordInput } from "@/components/ui/password-input"
import { PermissionTooltip } from "@/components/ui/permission-tooltip"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { SectionTabs } from "@/components/ui/section-tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { StateMatrixCheck } from "@/components/ui/state-matrix-check"
import { toast } from "@/components/ui/sonner"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { TimePicker, type TimeValue } from "@/components/ui/time-picker"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/* -------------------------------------------------------------------
   Page scaffolding local to this reference page. Nothing here is a
   product component; product screens use the section 11 templates.
   ------------------------------------------------------------------- */

function Section({
  n,
  title,
  note,
  children,
}: {
  n: string
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-12 first:mt-0">
      <h2 className="text-section font-medium text-text-primary">
        <span className="text-text-muted">{n}. </span>
        {title}
      </h2>
      {note ? (
        <p className="mt-2 max-w-[70ch] text-body text-text-secondary">{note}</p>
      ) : null}
      <div className="mt-6">{children}</div>
    </section>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>
}

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-meta text-text-muted">{children}</p>
}

/**
 * One column of the state matrix. `force` replays hover, pressed and
 * focus through the [data-force] rules in globals.css, so all four
 * states plus the focus ring are visible at once without a pointer or
 * the keyboard being on any of them.
 */
function StateCell({
  state,
  children,
}: {
  state: "resting" | "hover" | "pressed" | "disabled" | "focus"
  children: React.ReactNode
}) {
  const forced = state === "hover" || state === "pressed" || state === "focus"
  return (
    <div className="flex flex-col gap-2">
      <p className="text-meta text-text-muted">{state}</p>
      <div data-force={forced ? state : undefined}>{children}</div>
    </div>
  )
}

const STATES = ["resting", "hover", "pressed", "disabled", "focus"] as const

function StateMatrix({
  label,
  render,
}: {
  label: string
  render: (state: (typeof STATES)[number]) => React.ReactNode
}) {
  return (
    <div className="border-b border-border-light py-4 last:border-b-0">
      <p className="text-label text-text-secondary">{label}</p>
      <div className="mt-3 flex flex-wrap items-start gap-8">
        {STATES.map((s) => (
          <StateCell key={s} state={s}>
            {render(s)}
          </StateCell>
        ))}
      </div>
    </div>
  )
}

/**
 * Section 33, shown the way it is actually used: the tab bar reads the
 * active view out of the URL rather than holding it in state.
 */
function SectionTabsDemo() {
  const searchParams = useSearchParams()
  const view = searchParams.get("view") ?? "summary"

  return (
    <>
      <SectionTabs
        value={view}
        tabs={[
          { value: "summary", label: "Summary" },
          { value: "by-region", label: "By region" },
          { value: "by-month", label: "By month" },
        ]}
      />
      <p className="mt-4 text-body text-text-secondary">
        Showing the {view.replace("-", " ")} view. The toolbar's own state
        belongs to its tab: search, filters and sort do not carry across,
        because they filter different columns on each.
      </p>
    </>
  )
}

const COLOUR_GROUPS: {
  group: string
  tokens: { name: string; className: string; onDark?: boolean }[]
}[] = [
  {
    group: "Brand",
    tokens: [
      { name: "primary", className: "bg-primary", onDark: true },
      { name: "primary-hover", className: "bg-primary-hover", onDark: true },
      { name: "primary-pressed", className: "bg-primary-pressed", onDark: true },
      { name: "primary-ring", className: "bg-primary-ring", onDark: true },
      { name: "primary-subtle", className: "bg-primary-subtle" },
      { name: "primary-border", className: "bg-primary-border" },
    ],
  },
  {
    group: "Surfaces and lines",
    tokens: [
      { name: "surface", className: "bg-surface" },
      { name: "surface-sunken", className: "bg-surface-sunken" },
      { name: "surface-control", className: "bg-surface-control" },
      { name: "border", className: "bg-border" },
      { name: "border-light", className: "bg-border-light" },
      { name: "border-strong", className: "bg-border-strong" },
    ],
  },
  {
    group: "Status",
    tokens: [
      { name: "success", className: "bg-success", onDark: true },
      { name: "success-bg", className: "bg-success-bg" },
      { name: "warning", className: "bg-warning", onDark: true },
      { name: "warning-bg", className: "bg-warning-bg" },
      { name: "danger", className: "bg-danger", onDark: true },
      { name: "danger-bg", className: "bg-danger-bg" },
    ],
  },
  {
    group: "Charts",
    tokens: [
      { name: "chart-1", className: "bg-chart-1", onDark: true },
      { name: "chart-2", className: "bg-chart-2", onDark: true },
      { name: "chart-3", className: "bg-chart-3", onDark: true },
      { name: "chart-4", className: "bg-chart-4", onDark: true },
      { name: "chart-5", className: "bg-chart-5" },
      { name: "chart-6", className: "bg-chart-6", onDark: true },
    ],
  },
]

const TYPE_SLOTS = [
  { slot: "Page title", className: "text-page-title font-medium text-text-primary" },
  { slot: "Section heading", className: "text-section font-medium text-text-primary" },
  { slot: "Card heading", className: "text-card-heading font-medium text-text-primary" },
  { slot: "Body", className: "text-body text-text-primary" },
  { slot: "Body strong", className: "text-body font-medium text-text-primary" },
  { slot: "Label", className: "text-label text-text-secondary" },
  { slot: "Meta", className: "text-meta text-text-muted" },
]

const SPACING_STEPS = [
  { token: "space-1", className: "w-1" },
  { token: "space-2", className: "w-2" },
  { token: "space-3", className: "w-3" },
  { token: "space-4", className: "w-4" },
  { token: "space-6", className: "w-6" },
  { token: "space-8", className: "w-8" },
  { token: "space-12", className: "w-12" },
]

const REGIONS = {
  north: "North",
  south: "South",
  east: "East",
  west: "West",
}

/** Sixteen, to exercise the section 16.2 scroll cap and the 16.3 search box. */
const CATEGORIES = {
  adhesives: "Adhesives",
  bearings: "Bearings",
  belts: "Belts",
  cables: "Cables",
  castings: "Castings",
  connectors: "Connectors",
  fasteners: "Fasteners",
  filters: "Filters",
  gaskets: "Gaskets",
  hoses: "Hoses",
  lubricants: "Lubricants",
  motors: "Motors",
  pumps: "Pumps",
  seals: "Seals",
  valves: "Valves",
  washers: "Washers",
}

/**
 * Eight rows, so the 256px scroll box actually scrolls and the sticky
 * header has something to stay put against. Amounts run to lakh scale so
 * the section 18 digit grouping is visible; statuses cover all three.
 */
const ORDERS = [
  { customer: "Halcyon Supplies", order: "ORD-0148", date: "12 Aug 2026", units: "1,240", amount: "12,45,680.00", status: "success" as const },
  { customer: "Meridian Traders", order: "ORD-0147", date: "09 Aug 2026", units: "320", amount: "3,27,900.00", status: "warning" as const },
  { customer: "Northwind Components", order: "ORD-0146", date: "04 Aug 2026", units: "860", amount: "8,60,000.00", status: "danger" as const },
  { customer: "Ardent Industrial", order: "ORD-0145", date: "28 Jul 2026", units: "185", amount: "1,84,500.00", status: "success" as const },
  { customer: "Blue Harbour Logistics", order: "ORD-0144", date: "21 Jul 2026", units: "215", amount: "2,15,750.00", status: "warning" as const },
  { customer: "Cobalt Manufacturing", order: "ORD-0143", date: "14 Jul 2026", units: "96", amount: "96,400.00", status: "success" as const },
  { customer: "Delta Fabrication", order: "ORD-0142", date: "02 Jul 2026", units: "74", amount: "74,300.00", status: "danger" as const },
  { customer: "Evergreen Distributors", order: "ORD-0141", date: "26 Jun 2026", units: "45", amount: "45,200.00", status: "success" as const },
]

const LONG_CUSTOMER_NAME =
  "Northwind Components and Industrial Supplies Private Limited"

/* Section 34. TWELVE columns on purpose: 240px of frozen first column
   plus 12 x 120px is 1680px, which overflows the content area on a
   desktop as well as a laptop. A frozen first column proves nothing in
   a table that fits, and a demo that fits is how the trap below gets
   shipped — the same grid was reachable on a list page and clipped on a
   detail page, because Card is overflow-hidden and the list page's data
   area is not. A scrolling table needs a host that can scroll. */
const REPORT_MONTHS = [
  "Apr", "May", "Jun", "Jul", "Aug", "Sep",
  "Oct", "Nov", "Dec", "Jan", "Feb", "Mar",
]

const REPORT_ROWS = [
  { region: "North", values: ["4,12,000.00", "3,88,500.00", "4,40,100.00", "4,02,600.00", "4,61,900.00", "4,18,200.00", "3,96,400.00", "4,55,000.00", "4,30,800.00", "4,07,200.00", "4,49,600.00", "4,71,300.00"] },
  { region: "South", values: ["2,84,300.00", "3,01,700.00", "2,96,800.00", "3,15,400.00", "3,28,900.00", "3,04,100.00", "2,91,600.00", "3,22,700.00", "3,10,500.00", "2,98,300.00", "3,19,800.00", "3,34,200.00"] },
  { region: "East", values: ["1,62,400.00", "1,70,900.00", "1,58,200.00", "1,74,600.00", "1,81,300.00", "1,66,700.00", "1,59,800.00", "1,77,200.00", "1,68,900.00", "1,61,500.00", "1,73,400.00", "1,85,100.00"] },
  { region: "West", values: ["3,45,100.00", "3,62,800.00", "3,51,400.00", "3,70,200.00", "3,84,600.00", "3,58,900.00", "3,41,700.00", "3,79,500.00", "3,66,200.00", "3,49,800.00", "3,74,100.00", "3,91,600.00"] },
]

/* Section 21. The value is the bar's length and is a number because a
   pixel measurement cannot be anything else; the text beside it is
   formatted by the caller, so the digits a person reads never went
   through a float. */
const CHART_ROWS = [
  { region: "North", planned: 4800000, plannedText: "48,00,000.00", actual: 5217600, actualText: "52,17,600.00" },
  { region: "South", planned: 3600000, plannedText: "36,00,000.00", actual: 3348900, actualText: "33,48,900.00" },
  { region: "East", planned: 2100000, plannedText: "21,00,000.00", actual: 1908400, actualText: "19,08,400.00" },
  { region: "West", planned: 4200000, plannedText: "42,00,000.00", actual: 4463200, actualText: "44,63,200.00" },
]

const REPORT_TOTALS = [
  "12,03,800.00", "12,23,900.00", "12,46,500.00", "12,62,800.00",
  "13,56,700.00", "12,47,900.00", "11,89,500.00", "13,34,400.00",
  "12,76,400.00", "12,16,800.00", "13,16,900.00", "13,82,200.00",
]

export default function KitchenSinkPage() {
  const [date, setDate] = React.useState<Date | undefined>(
    new Date(2026, 7, 12)
  )
  const [time, setTime] = React.useState<TimeValue | undefined>({
    hour: 9,
    minute: 30,
    meridiem: "AM",
  })
  const [category, setCategory] = React.useState<string | undefined>("gaskets")

  return (
    <main className="mx-auto w-full max-w-content-max p-6">
      <header>
        <h1 className="text-page-title font-medium text-text-primary">
          Kitchen sink
        </h1>
        <p className="mt-2 text-label text-text-secondary">
          Every primitive in every state. This page is the reference for
          what the components do, not a product screen.
        </p>
      </header>

      <div className="mt-12">
        {/* ---------------------------------------------------------- */}
        <Section
          n="1"
          title="Colour tokens"
          note="Named by job, never by value. Every one resolves to a variable in globals.css, which is the only file that contains a colour. Change the brand there and this whole page follows."
        >
          <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {COLOUR_GROUPS.map((g) => (
              <div key={g.group}>
                <p className="text-label text-text-secondary">{g.group}</p>
                <div className="mt-3 overflow-hidden rounded-xl border border-border-light">
                  {g.tokens.map((t) => (
                    <div
                      key={t.name}
                      className={`flex h-9 items-center px-3 text-meta ${t.className} ${
                        t.onDark ? "text-primary-foreground" : "text-text-primary"
                      }`}
                    >
                      {t.name}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <Caption>
            Status colours never change when the brand colour changes. There
            is deliberately no blue information colour; neutral grey carries
            informational content.
          </Caption>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="2"
          title="Type scale"
          note="Two weights exist, 400 and 500. If a heading is not standing out enough, add space around it rather than weight. Labels are always text-secondary; a label in text-primary reads as body text and the hierarchy collapses."
        >
          <div className="overflow-hidden rounded-xl border border-border-light bg-surface">
            {TYPE_SLOTS.map((t) => (
              <div
                key={t.slot}
                className="flex items-baseline gap-6 border-b border-border-light px-4 py-3 last:border-b-0"
              >
                <span className="w-36 shrink-0 text-meta text-text-muted">
                  {t.slot}
                </span>
                <span className={t.className}>Halcyon Supplies, order 0148</span>
              </div>
            ))}
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="3"
          title="Spacing scale"
          note="Only these steps exist. There is no space-5, space-7 or space-9. If 16 feels too small and 24 too big, the answer is one of those two, never 20."
        >
          <div className="rounded-xl border border-border-light bg-surface p-4">
            {SPACING_STEPS.map((s) => (
              <div key={s.token} className="flex items-center gap-4 py-1">
                <span className="w-24 shrink-0 text-meta text-text-muted">
                  {s.token}
                </span>
                <span className={`h-3 bg-primary-subtle ${s.className}`} />
              </div>
            ))}
          </div>
          <Caption>
            Space belongs above an element, not below, so a heading stays
            attached to its own content instead of floating between two
            blocks.
          </Caption>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="4"
          title="State matrix"
          note="Section 6.4: every interactive element defines four states, and keyboard focus shows a visible ring in primary-ring. Hover, pressed and focus are replayed here through [data-force] rules scoped to this page, so all five columns are visible at once without a pointer sitting on any of them."
        >
          <div className="rounded-xl border border-border-light bg-surface px-4">
            <StateMatrix
              label="Button, primary"
              render={(s) => <Button disabled={s === "disabled"}>Save customer</Button>}
            />
            <StateMatrix
              label="Button, secondary"
              render={(s) => (
                <Button variant="secondary" disabled={s === "disabled"}>
                  Cancel
                </Button>
              )}
            />
            <StateMatrix
              label="Button, ghost"
              render={(s) => (
                <Button variant="ghost" disabled={s === "disabled"}>
                  Toolbar action
                </Button>
              )}
            />
            <StateMatrix
              label="Button, danger"
              render={(s) => (
                <Button variant="danger" disabled={s === "disabled"}>
                  Delete customer
                </Button>
              )}
            />
            <StateMatrix
              label="Icon button, 36x36"
              render={(s) => (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Edit customer"
                  disabled={s === "disabled"}
                >
                  <PencilIcon />
                </Button>
              )}
            />
            {/* Section 6.3.1. No fill and no border at rest - the field
                around it is the container - so its states have to be
                visible on the background alone. A grey box is drawn
                behind it here only so the resting cell is not an empty
                square; the real one is the field's own border. */}
            <StateMatrix
              label="Icon button in a field"
              render={(s) => (
                <div className="inline-flex h-control items-center rounded-lg border border-border px-1">
                  <Button
                    variant="in-field"
                    size="icon-sm"
                    aria-label="Show password"
                    disabled={s === "disabled"}
                  >
                    <EyeIcon />
                  </Button>
                </div>
              )}
            />
            <StateMatrix
              label="Input"
              render={(s) => (
                <Input
                  className="w-44"
                  defaultValue="Halcyon Supplies"
                  disabled={s === "disabled"}
                />
              )}
            />
            <StateMatrix
              label="Textarea"
              render={(s) => (
                <Textarea
                  className="min-h-16 w-44"
                  defaultValue="Delivered short"
                  disabled={s === "disabled"}
                />
              )}
            />
            <StateMatrix
              label="Select trigger"
              render={(s) => (
                <Select defaultValue="north" items={REGIONS} disabled={s === "disabled"}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="north">North</SelectItem>
                    <SelectItem value="south">South</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            <StateMatrix
              label="Tick box"
              render={(s) => (
                <Checkbox defaultChecked disabled={s === "disabled"} aria-label="Select" />
              )}
            />
            <StateMatrix
              label="Radio"
              render={(s) => (
                <RadioGroup defaultValue="a">
                  <RadioGroupItem value="a" disabled={s === "disabled"} aria-label="Option" />
                </RadioGroup>
              )}
            />
            <StateMatrix
              label="Switch"
              render={(s) => (
                <Switch defaultChecked disabled={s === "disabled"} aria-label="Toggle" />
              )}
            />
          </div>
          {/* The matrix checking itself. Silence is the pass; anything
              whose forced state is identical to its resting state gets
              named in a danger panel here. */}
          <StateMatrixCheck />
          <Caption>
            The disabled column reduces contrast and removes the pointer
            cursor. The focus column is the ring a keyboard user sees; it is
            never removed. A state matrix can only verify what it forces, so
            the check above compares every forced cell against its resting
            twin and complains about any that are indistinguishable — a
            control rendering its resting appearance in the hover column
            looks exactly like a control that passed.
          </Caption>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="5"
          title="Buttons in use"
          note="Exactly one primary button per screen or dialog; everything else is secondary. Ghost keeps a fill and a border, because a control the user cannot see is a control is broken."
        >
          <Row>
            <Button>
              <PlusIcon />
              New order
            </Button>
            <Button variant="secondary">
              <DownloadIcon />
              Download
            </Button>
            <Button variant="secondary">
              <FilterIcon />
              Filter
              <Badge variant="primary">2</Badge>
            </Button>
          </Row>
          <Caption>Icons are 16px in a button and sit 4px from their label.</Caption>

          <div className="mt-6">
            <Row>
              <Button size="sm">Small, 32px</Button>
              <Button>Default, 36px</Button>
              <Button size="lg">Large, 40px</Button>
            </Row>
            <Caption>
              Height is fixed. Width grows with the label; height never does.
            </Caption>
          </div>

          <div className="mt-6">
            <Row>
              <Tooltip>
                <TooltipTrigger
                  render={<Button variant="ghost" size="icon" aria-label="Edit customer" />}
                >
                  <PencilIcon />
                </TooltipTrigger>
                <TooltipContent>Edit customer</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={<Button variant="ghost" size="icon-sm" aria-label="Search" />}
                >
                  <SearchIcon />
                </TooltipTrigger>
                <TooltipContent>Search</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={<Button variant="primary" size="icon" aria-label="Add row" />}
                >
                  <PlusIcon />
                </TooltipTrigger>
                <TooltipContent>Add row</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={<Button variant="danger" size="icon" aria-label="Delete row" />}
                >
                  <TrashIcon />
                </TooltipTrigger>
                <TooltipContent>Delete row</TooltipContent>
              </Tooltip>
            </Row>
            <Caption>
              Every icon-only button carries a hidden text label and a tooltip.
              An icon alone is a guess. Hover one to see the tooltip.
            </Caption>

            <div className="mt-6">
              <Row>
                <PermissionTooltip allowed={false} reason="Only an administrator can delete clients">
                  <Button variant="danger" disabled>
                    Delete client
                  </Button>
                </PermissionTooltip>
                <PermissionTooltip allowed reason="Only an administrator can delete clients">
                  <Button variant="secondary">Edit client</Button>
                </PermissionTooltip>
              </Row>
              <Caption>
                Section 26. The first button is disabled, so it carries
                pointer-events-none and can never receive a hover — a tooltip
                on the button itself would be written and never readable. The
                wrapper catches the hover instead, and is focusable, because a
                keyboard user has no other route to the reason. The second is
                permitted and renders with no wrapper at all.
              </Caption>
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="6"
          title="Badges and avatars"
          note="Status is always a badge, never plain coloured text. Every status badge carries an icon as well as a colour, because colour alone is invisible to colour-blind users."
        >
          <Row>
            <Badge variant="success">
              <CheckIcon />
              Paid
            </Badge>
            <Badge variant="warning">
              <TriangleAlertIcon />
              Pending
            </Badge>
            <Badge variant="danger">
              <OctagonXIcon />
              Overdue
            </Badge>
            <Badge>Draft</Badge>
            <Badge variant="primary">12</Badge>
          </Row>
          <Caption>
            Neutral is the default: a notification or a count is neither
            success nor failure.
          </Caption>
          <div className="mt-6">
            <Row>
              <Avatar size="sm">
                <AvatarFallback>HS</AvatarFallback>
              </Avatar>
              <Avatar>
                <AvatarFallback>MT</AvatarFallback>
              </Avatar>
              <Avatar size="lg">
                <AvatarFallback>NC</AvatarFallback>
              </Avatar>
            </Row>
            <Caption>Initials only. No images are loaded in this system yet.</Caption>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="7"
          title="Fields"
          note="A field is as wide as the data it holds. Labels sit above the field, never beside it and never as placeholder text. Placeholder text shows an example format only."
        >
          <div className="rounded-xl border border-border-light bg-surface p-4">
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 sm:col-span-6">
                <Label htmlFor="ks-customer" required>
                  Customer name
                </Label>
                <Input
                  id="ks-customer"
                  className="mt-1.5"
                  defaultValue="Halcyon Supplies"
                />
              </div>
              <div className="col-span-12 sm:col-span-4">
                <Label htmlFor="ks-date">Order date</Label>
                <div className="mt-1.5">
                  <DatePicker id="ks-date" value={date} onValueChange={setDate} />
                </div>
              </div>
              <div className="col-span-12 sm:col-span-3">
                <Label htmlFor="ks-time">Time</Label>
                <div className="mt-1.5">
                  <TimePicker id="ks-time" value={time} onValueChange={setTime} />
                </div>
              </div>
              <div className="col-span-12 sm:col-span-3">
                <Label htmlFor="ks-units">Units</Label>
                <Input id="ks-units" className="mt-1.5 text-right" defaultValue="1,240" />
              </div>
              <div className="col-span-12 sm:col-span-3">
                <Label htmlFor="ks-amount">Amount</Label>
                <div className="mt-1.5">
                  <InputGroup>
                    <InputGroupAddon>
                      <IndianRupeeIcon />
                    </InputGroupAddon>
                    <InputGroupInput
                      id="ks-amount"
                      defaultValue="4,200.00"
                      className="text-right"
                    />
                  </InputGroup>
                </div>
              </div>
              <div className="col-span-12 sm:col-span-4">
                <Label htmlFor="ks-invalid">Invoice number</Label>
                <Input id="ks-invalid" className="mt-1.5" defaultValue="—" aria-invalid />
                <InlineFieldError>
                  Enter the invoice number printed on the invoice, like
                  INV/2026/114.
                </InlineFieldError>
              </div>
              <div className="col-span-12 sm:col-span-4">
                <Label htmlFor="ks-disabled">Region</Label>
                <Input
                  id="ks-disabled"
                  className="mt-1.5"
                  defaultValue="North"
                  disabled
                />
              </div>
              <div className="col-span-12 sm:col-span-6">
                <Label htmlFor="ks-password">Password</Label>
                <PasswordInput
                  id="ks-password"
                  className="mt-1.5"
                  defaultValue="correct horse battery staple"
                />
              </div>
              <div className="col-span-12">
                <Label htmlFor="ks-notes">Remarks</Label>
                <Textarea
                  id="ks-notes"
                  className="mt-1.5"
                  placeholder="Anything the next person needs to know"
                />
              </div>
            </div>
          </div>
          <Caption>
            3 columns for an amount, a quantity or a time, 4 for a date or a
            short dropdown, 6 for a name, 12 for anything free-form. Error
            text states the cause, then the next action.
          </Caption>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="8"
          title="Date and time pickers"
          note="Both accept typed entry as well as selection. Forcing someone to click through a calendar for a date they already know is slow. The week starts on Monday, today is outlined and the selected day is filled with primary. Minutes step in 15s and there are no seconds."
        >
          <div className="flex flex-wrap items-start gap-8">
            <div className="w-56">
              <Label htmlFor="ks-date-2">Date, 4 columns</Label>
              <div className="mt-1.5">
                <DatePicker id="ks-date-2" value={date} onValueChange={setDate} />
              </div>
            </div>
            <div className="w-40">
              <Label htmlFor="ks-time-2">Time, 3 columns</Label>
              <div className="mt-1.5">
                <TimePicker id="ks-time-2" value={time} onValueChange={setTime} />
              </div>
            </div>
            <div>
              <p className="text-label text-text-secondary">Calendar, on its own</p>
              <div className="mt-1.5">
                <Popover>
                  <PopoverTrigger
                    render={<Button variant="secondary">Open the calendar</Button>}
                  />
                  <PopoverContent align="start" className="w-auto p-2">
                    <Calendar mode="single" selected={date} onSelect={setDate} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
          <Caption>
            Type "9:20" into the time field and it snaps to the nearest
            15-minute step rather than rejecting the entry. The calendar
            only ever renders inside a popover, which mounts when it is
            opened - it is never server-rendered, so react-day-picker
            deriving "today" at render time cannot cause a mismatch.
          </Caption>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="9"
          title="Dropdowns, menus and pickers"
          note="The menu is exactly the trigger's width. Selected and hovered look different: selected is primary-subtle with a tick, hovered is neutral grey. Sharing one style makes it impossible to tell what is actually chosen."
        >
          <div className="flex flex-wrap items-start gap-6">
            <div className="w-64">
              <Label htmlFor="ks-select">Region</Label>
              <div className="mt-1.5">
                <Select defaultValue="north" items={REGIONS}>
                  <SelectTrigger id="ks-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="north">North</SelectItem>
                    <SelectItem value="south">South</SelectItem>
                    <SelectItem value="east">East</SelectItem>
                    <SelectItem value="west">West</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="w-64">
              <Label htmlFor="ks-select-empty">Empty</Label>
              <div className="mt-1.5">
                <Select items={REGIONS}>
                  <SelectTrigger id="ks-select-empty">
                    <SelectValue placeholder="Select a region" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="north">North</SelectItem>
                    <SelectItem value="south">South</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="pt-6">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="secondary">Row actions</Button>}
                />
                <DropdownMenuContent>
                  <DropdownMenuLabel>Halcyon Supplies</DropdownMenuLabel>
                  <DropdownMenuItem>
                    <PencilIcon />
                    Edit customer
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <DownloadIcon />
                    Download orders
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="danger">
                    <TrashIcon />
                    Delete customer
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="pt-6">
              <Popover>
                <PopoverTrigger render={<Button variant="secondary">Filter panel</Button>} />
                <PopoverContent align="start">
                  <p className="text-label text-text-secondary">Region</p>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <Checkbox id="ks-f1" defaultChecked />
                      <Label htmlFor="ks-f1">North</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox id="ks-f2" />
                      <Label htmlFor="ks-f2">South</Label>
                    </div>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <Button variant="secondary" size="sm">
                      Clear all
                    </Button>
                    <Button size="sm">Apply</Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            <div className="pt-6">
              <Sheet>
                <SheetTrigger render={<Button variant="secondary">Open sheet</Button>} />
                <SheetContent side="right">
                  <SheetHeader>
                    <SheetTitle>Customer details</SheetTitle>
                    <SheetDescription>
                      A sheet is for a side task that keeps the list visible
                      behind it.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="px-4">
                    <p className="text-body text-text-secondary">
                      Halcyon Supplies, North region. Last order 12 Aug 2026.
                    </p>
                  </div>
                  <SheetFooter>
                    <SheetClose render={<Button variant="secondary">Close</Button>} />
                  </SheetFooter>
                </SheetContent>
              </Sheet>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-start gap-6">
            <div className="w-64">
              <Label htmlFor="ks-long-select">Sixteen options, plain dropdown</Label>
              <div className="mt-1.5">
                <Select defaultValue="adhesives" items={CATEGORIES}>
                  <SelectTrigger id="ks-long-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORIES).map(([v, label]) => (
                      <SelectItem key={v} value={v}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Caption>
                Here only to show the section 16.2 scroll cap: the menu stops
                at about seven rows and scrolls internally. A list this long
                should not be a plain dropdown in a product screen.
              </Caption>
            </div>

            <div className="w-64">
              <Label htmlFor="ks-searchable">Sixteen options, searchable</Label>
              <div className="mt-1.5">
                <SearchableSelect
                  id="ks-searchable"
                  options={CATEGORIES}
                  value={category}
                  onValueChange={setCategory}
                  searchPlaceholder="Search categories"
                  emptyMessage="No category matches that search."
                />
              </div>
              <Caption>
                Section 16.3: past six options the menu gets a search box fixed
                at the top, which does not scroll with the options. This is
                what a long list uses.
              </Caption>
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="10"
          title="Text overflow"
          note="Text must never overflow its container. Truncate for table cells and rows, one line ending in three dots with the full text as a tooltip. Clamp for card descriptions and previews, two lines then a Show more link."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border-light bg-surface p-4">
              <p className="text-label text-text-secondary">Truncate</p>
              <div className="mt-3 w-64 rounded-lg border border-border-light px-3 py-2">
                <Truncate>{LONG_CUSTOMER_NAME}</Truncate>
              </div>
              <Caption>Hover it: the full name appears as a tooltip.</Caption>
              <div className="mt-3 w-64 rounded-lg border border-border-light px-3 py-2">
                <Truncate>Halcyon Supplies</Truncate>
              </div>
              <Caption>
                A name that fits gets no tooltip. A tooltip that repeats what
                is already on screen is noise.
              </Caption>
            </div>
            <div className="rounded-xl border border-border-light bg-surface p-4">
              <p className="text-label text-text-secondary">Clamp</p>
              <div className="mt-3">
                <Clamp className="text-body text-text-secondary">
                  This account is billed monthly against one consolidated
                  invoice rather than per order, at the customer's own
                  request, and it carries a thirty day credit period agreed
                  when the contract was last renewed. Any order above two
                  lakh needs approval from the accounts team before dispatch.
                </Clamp>
              </div>
              <Caption>
                Two lines, then Show more. This is also how a grid of cards
                stays level.
              </Caption>
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="11"
          title="Tabs and breadcrumbs"
          note="Breadcrumbs replace back arrows, because a back button does something different depending on how the user arrived. The active tab carries a 2px accent, primary text and medium weight - three signals together."
        >
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="#">Customers</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Halcyon Supplies</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          <Tabs defaultValue="orders" className="mt-6">
            <TabsList>
              <TabsTrigger value="orders">Orders</TabsTrigger>
              <TabsTrigger value="invoices">Invoices</TabsTrigger>
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="locked" disabled>
                Disabled
              </TabsTrigger>
            </TabsList>
            <TabsContent value="orders">
              <p className="text-body text-text-secondary">
                Orders placed by this customer. The panel keeps the same
                padding on every tab, so switching does not shift the layout.
              </p>
            </TabsContent>
            <TabsContent value="invoices">
              <p className="text-body text-text-secondary">
                Invoices raised against those orders.
              </p>
            </TabsContent>
            <TabsContent value="summary">
              <p className="text-body text-text-secondary">
                Ordered against delivered, one row per line item.
              </p>
            </TabsContent>
          </Tabs>

          <Caption>
            Those are a detail page's tabs: one record's child collections.
            Below is the other job the same component does — sibling views of
            one section, with the active view in the URL.
          </Caption>

          {/*
            Section 33. useSearchParams reads a value that only exists per
            request, so it needs a Suspense boundary above it or the route
            quietly stops being prerenderable.
          */}
          <React.Suspense
            fallback={<Skeleton className="mt-6 h-control w-full max-w-md" />}
          >
            <SectionTabsDemo />
          </React.Suspense>
          <Caption>
            The active tab is a query parameter, so a view can be linked to
            and the browser's own back button returns to the tab the user came
            from. Switching replaces the history entry rather than pushing
            one: flipping between three views should not make the back button
            walk through every flip. Maximum four — a fifth throws.
          </Caption>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="12"
          title="Table"
          note="Numbers are right-aligned and text is left-aligned, always. Column headers stay put while rows scroll. A selected row is tinted primary-subtle; the total row carries body-strong weight."
        >
          <div className="overflow-hidden rounded-xl border border-border-light bg-surface">
            <div className="max-h-64 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <span className="sr-only">Select</span>
                    </TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Order</TableHead>
                    <TableHead numeric>Date</TableHead>
                    <TableHead numeric>Units</TableHead>
                    <TableHead numeric>Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ORDERS.map((o, i) => (
                    <TableRow key={o.order} selected={i === 0}>
                      <TableCell>
                        <Checkbox defaultChecked={i === 0} aria-label={o.customer} />
                      </TableCell>
                      <TableCell className="max-w-48">
                        <Truncate>
                          {i === 2 ? LONG_CUSTOMER_NAME : o.customer}
                        </Truncate>
                      </TableCell>
                      <TableCell>{o.order}</TableCell>
                      <TableCell numeric>{o.date}</TableCell>
                      <TableCell numeric>{o.units}</TableCell>
                      <TableCell numeric>{o.amount}</TableCell>
                      <TableCell>
                        <Badge variant={o.status}>
                          {o.status === "success" ? <CheckIcon /> : null}
                          {o.status === "warning" ? <TriangleAlertIcon /> : null}
                          {o.status === "danger" ? <OctagonXIcon /> : null}
                          {o.status === "success"
                            ? "Paid"
                            : o.status === "warning"
                              ? "Pending"
                              : "Overdue"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell />
                    <TableCell>Total</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell numeric>3,035</TableCell>
                    <TableCell numeric>30,49,730.00</TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
            <PaginationBar>
              <PaginationCount>Showing 1 to 8 of 148</PaginationCount>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious href="#" />
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationLink href="#" isActive>
                      1
                    </PaginationLink>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationLink href="#">2</PaginationLink>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationLink href="#">3</PaginationLink>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext href="#" />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </PaginationBar>
          </div>
          <Caption>
            The third row's name is truncated with a tooltip. Eight rows in
            a 256px box, so the header stays put while the body scrolls.
            Amounts and dates are static text here; the formatting utilities
            for the rupee symbol, Indian digit grouping and DD Mon YYYY are
            not built yet.
          </Caption>

          {/* Section 34. A report table, which is a different thing from
              the list table above: read-only, does not paginate, and its
              total row is the answer. */}
          <div className="mt-8 overflow-hidden rounded-xl border border-border-light bg-surface">
            <div className="max-h-56 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 z-30 w-grid-head bg-surface-sunken after:absolute after:top-0 after:right-0 after:h-full after:border-r after:border-border-light">
                      Region
                    </TableHead>
                    {REPORT_MONTHS.map((m) => (
                      <TableHead key={m} numeric className="min-w-grid-cell">
                        {m}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {REPORT_ROWS.map((row) => (
                    <TableRow key={row.region}>
                      <TableCell className="sticky left-0 z-10 bg-surface after:absolute after:top-0 after:right-0 after:h-full after:border-r after:border-border-light">
                        {row.region}
                      </TableCell>
                      {row.values.map((v, i) => (
                        <TableCell key={REPORT_MONTHS[i]} numeric>
                          {v}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter sticky>
                  <TableRow>
                    <TableCell className="left-0 z-30 bg-surface-sunken after:absolute after:top-0 after:right-0 after:h-full after:border-r after:border-border-light">
                      Total
                    </TableCell>
                    {REPORT_TOTALS.map((t, i) => (
                      <TableCell key={REPORT_MONTHS[i]} numeric>
                        {t}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </div>
          <Caption>
            Section 34. The total row is pinned the same way the column
            header is — a header says what a column means, a total says what
            the report concluded, and the second is the one worth keeping on
            screen. The first column freezes when the table scrolls sideways,
            with a 1px right border so cells sliding underneath read as a
            boundary rather than as clipping. It does not paginate: a report
            has as many rows as it has, and a table whose rows grow with use
            is a list and does paginate.
          </Caption>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="13"
          title="Cards"
          note="12px radius, a 1px border-light edge, no shadow. Descriptions clamp to two lines so a grid of cards stays level."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <div className="min-w-0">
                  <CardTitle>Halcyon Supplies</CardTitle>
                  <CardDescription>
                    North region · 1,240 units · 12 open orders
                  </CardDescription>
                </div>
                <CardAction>
                  <Badge variant="success">
                    <CheckIcon />
                    Active
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                <p className="text-body text-text-secondary">
                  The whole card is clickable in a list, not only the title.
                </p>
              </CardContent>
              <CardFooter>
                <Button variant="secondary" size="sm">
                  View customer
                </Button>
              </CardFooter>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Loading</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Separator</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-body text-text-secondary">Above the line</p>
                <Separator className="my-3" />
                <p className="text-body text-text-secondary">Below the line</p>
              </CardContent>
            </Card>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="14"
          title="Charts"
          note="Section 21. The six categorical colours are used in order and the caller cannot reach a status colour, so a red bar meaning a quarter is not an available mistake. Bars start at zero, a seventh series throws rather than inventing a colour, and every bar carries its own value so the eye never travels to a legend and back."
        >
          <Card>
            <CardHeader>
              <CardTitle>Revenue by region</CardTitle>
              <CardDescription>
                Two series over the same categories.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CategoryBarChart
                data={CHART_ROWS}
                category={(r) => r.region}
                series={[
                  {
                    label: "Planned",
                    value: (r) => r.planned,
                    format: (r) => r.plannedText,
                  },
                  {
                    label: "Actual",
                    value: (r) => r.actual,
                    format: (r) => r.actualText,
                  },
                ]}
              />
            </CardContent>
          </Card>
          <Caption>
            The chart measures its own container rather than using
            ResponsiveContainer, because a ResizeObserver never fires in a
            tab that is not being painted — including an automated check run
            against a background tab. It measures once directly on mount,
            then observes.
          </Caption>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="15"
          title="Messages"
          note="Can the user ignore it and carry on? Yes and temporary means a toast. Yes but it stays true means a banner. No means a dialog. About one field means an inline field error. A toast is never used for a field validation error."
        >
          <div className="flex flex-col gap-4">
            <Banner>
              <CircleAlertIcon />
              <BannerTitle>Three customers have no credit limit set</BannerTitle>
              <BannerDescription>
                Their orders are still accepted, but the limit cannot be
                enforced until a value is entered against the account.
              </BannerDescription>
              <BannerAction>
                <Button size="sm" variant="secondary">
                  Show those customers
                </Button>
              </BannerAction>
            </Banner>

            <Banner variant="success">
              <CheckIcon />
              <BannerTitle>Credit limit saved</BannerTitle>
              <BannerDescription>
                All eleven accounts on the review list now carry a limit.
              </BannerDescription>
            </Banner>

            <Banner variant="warning">
              <TriangleAlertIcon />
              <BannerTitle>Order quantity changed</BannerTitle>
              <BannerDescription>
                Order 0148 moved from 1,240 to 1,180 units, so every amount on
                the order has been recalculated.
              </BannerDescription>
            </Banner>

            <Banner variant="danger">
              <OctagonXIcon />
              <BannerTitle>The order could not be saved</BannerTitle>
              <BannerDescription>
                The connection dropped partway through. Nothing was recorded,
                so the entry is safe to submit again.
              </BannerDescription>
              <BannerAction>
                <Button size="sm" variant="secondary">
                  Try again
                </Button>
              </BannerAction>
            </Banner>
          </div>

          <div className="mt-6">
            <Row>
              <Button variant="secondary" onClick={() => toast.success("Customer saved")}>
                Success toast
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  toast.error("The order could not be saved. Nothing was recorded.")
                }
              >
                Error toast, never auto-dismisses
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  toast.undo("9 orders deleted", () => toast.message("Restored"))
                }
              >
                Toast with Undo
              </Button>
            </Row>
            <Caption>
              Bottom right, 360px fixed, at most three stacked, every one with
              a close button.
            </Caption>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="16"
          title="Dialogs"
          note="Three widths: 400 for confirmations, 560 for short forms, 800 when there are tabs or a table inside. A confirmation that does not state the consequences is not a confirmation, it is a speed bump."
        >
          <Row>
            <Dialog>
              <DialogTrigger
                render={<Button variant="secondary">Short form, 560px</Button>}
              />
              <DialogContent size="md">
                <DialogHeader>
                  <DialogTitle>Add line item</DialogTitle>
                  <DialogDescription>
                    The unit price is multiplied by the quantity to give the
                    line total.
                  </DialogDescription>
                </DialogHeader>
                <DialogBody>
                  <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-12 sm:col-span-6">
                      <Label htmlFor="ks-item" required>
                        Item
                      </Label>
                      <Input id="ks-item" className="mt-1.5" placeholder="Gaskets" />
                    </div>
                    <div className="col-span-12 sm:col-span-3">
                      <Label htmlFor="ks-unit-price" required>
                        Unit price
                      </Label>
                      <Input
                        id="ks-unit-price"
                        className="mt-1.5 text-right"
                        placeholder="34.00"
                      />
                    </div>
                  </div>
                </DialogBody>
                <DialogFooter>
                  <DialogClose render={<Button variant="secondary">Cancel</Button>} />
                  <Button>Add line item</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <AlertDialog>
              <AlertDialogTrigger render={<Button variant="danger">Delete customer</Button>} />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Halcyon Supplies?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will also remove 11 orders and 214 invoice lines. It
                    cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction>Delete customer</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </Row>
          <Caption>
            The confirm button states the actual verb, never OK or Yes. Cancel
            is the safer option and sits on the left. A confirmation closes
            only through Cancel or the action, so Escape and the backdrop do
            nothing.
          </Caption>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="17"
          title="Empty states"
          note="Three, not one. The variant is a closed set rather than free-form props, because offering 'Add your first customer' to someone whose filter simply matched nothing makes the software look unintelligent."
        >
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-border-light bg-surface">
              <EmptyState
                variant="nothing-yet"
                heading="No customers yet"
                actionLabel="New customer"
              >
                A customer holds the contact details, the credit limit and the
                order history for one account. Add the first one to begin.
              </EmptyState>
            </div>
            <div className="rounded-xl border border-border-light bg-surface">
              <EmptyState variant="nothing-found" heading="No customers match “harbour”">
                Two filters are still applied. Clearing them will widen the
                search.
              </EmptyState>
            </div>
            <div className="rounded-xl border border-border-light bg-surface">
              <EmptyState variant="failed" heading="The list could not be loaded">
                The connection dropped while fetching customers. Nothing has
                changed.
              </EmptyState>
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="18"
          title="Loading"
          note="Skeletons in the shape of the content that is coming, never a spinning wheel. The layout arrives first, so the page does not jump when the data lands."
        >
          <div className="overflow-hidden rounded-xl border border-border-light bg-surface">
            <div className="flex items-center gap-4 border-b border-border-light bg-surface-sunken px-4 py-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="ml-auto h-control w-28" />
            </div>
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center gap-4 border-b border-border-light px-4 py-3 last:border-b-0"
              >
                <Skeleton className="h-4 w-4 rounded-(--radius-tick)" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="ml-auto h-4 w-24" />
              </div>
            ))}
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="19"
          title="Scrollbars"
          note="The browser default is never used. 10px, fully rounded, in the scroll tokens. A scrolling area never nests inside another one."
        >
          <div className="max-h-40 max-w-md overflow-y-auto rounded-xl border border-border-light bg-surface p-4">
            {Array.from({ length: 14 }).map((_, i) => (
              <p key={i} className="py-1 text-body text-text-secondary">
                Row {i + 1} — the thumb and track come from the scroll tokens.
              </p>
            ))}
          </div>
        </Section>
      </div>
    </main>
  )
}
