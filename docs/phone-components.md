# Phone building blocks

Reference for screen agents. Read this instead of the kit's source.

## App bar — `src/components/shell/phone-app-bar.tsx`
`usePhoneAppBar({ title, back?, actions?, menu? })` — call once per screen below a
tab root. No `back` = no arrow (tab roots only). `PhoneShell` renders it; falls back
to the tab label with no arrow when nothing is registered.
```tsx
usePhoneAppBar({ title: company.name, back: '/parties', actions: <ShareButton /> })
```

## Tab bar / shell — `src/components/shell/phone-shell.tsx`
Mounted by `(protected)/layout.tsx`. Hides the tab bar while the keyboard is open
(`useKeyboardInset`, `src/lib/use-keyboard-inset.ts`). Nothing to call directly.

## Lists — `src/components/ui/phone-list.tsx`
`<PhoneList state rows total rowKey renderRow search add noun />`, rows via
`<PhoneListRow href name status facts amount meta />`. Renders nothing off-phone.
Filter chips, pull-to-refresh and saved scroll position are backwards-compatible
additions — every existing call keeps working unchanged.
```tsx
<PhoneList
  state={state} rows={rows} total={total} rowKey={r => r.id} renderRow={renderRow}
  search={search} noun={{ one: 'order', many: 'orders' }} empty={<Empty />}
  filters={{
    label: 'Status', value: status, onChange: setStatus,
    allLabel: 'All', allCount: total,
    chips: [{ value: 'Draft', label: 'Draft', count: draftCount }, { value: 'Placed', label: 'Placed', count: placedCount }],
  }}
  onRefresh={reload}
/>
<PhoneListRow href={`/orders/${o.id}`} name={o.partyName} status={<StatusBadge vocabulary={ORDER_STATUS} status={o.status} />} />
```
Scroll position is saved to `sessionStorage` under the pathname (or `listKey`) and
restored on return; wrapped in `try/catch`.

## Bottom action bar — `src/components/ui/action-bar.tsx`
`<ActionBar>{cancelBtn}{saveBtn}</ActionBar>` — max 2 buttons, secondary first.
Rises above the keyboard automatically.

## Form scaffold — `src/components/ui/phone-form.tsx`
```tsx
const { requestLeave, warning } = usePhoneFormGuard(changed)
<PhoneForm onSave={save} saving={saving} changed={changed}>
  <PhoneFormField label="Name"><Input ... /></PhoneFormField>
  <PhoneFormMore summary="More details"><PhoneFormField label="Notes">...</PhoneFormField></PhoneFormMore>
</PhoneForm>
{warning}
```
Route your own back/cancel control through `requestLeave(() => router.push(back))`.
**Gap:** guards only the control you route through it, not every link on the page
(the kit's unsaved-changes.tsx intercepts all of them — not ported).

## Permission tooltip — `src/components/ui/permission-tooltip.tsx` (pre-existing)
`<PermissionTooltip allowed={can} reason="Only an administrator can delete clients">
  <Button disabled={!can}>Delete</Button>
</PermissionTooltip>` — while permission is still loading, pass `allowed={false}`
with no `reason` text shown (loading state is the caller's job to detect first).

## Sheets — `src/components/ui/sheet.tsx` (pre-existing)
`<Sheet><SheetContent side="bottom">...</SheetContent></Sheet>` — use `side="bottom"`
for pickers/menus/"Move to" per §41.8.

## Picker sheet — `src/components/ui/picker-sheet.tsx`
Full-height bottom-sheet field for a select/searchable-select on phone (§41.8 rule 7).
`PickerSheetField` searches the server (debounced 300ms); `StaticPickerSheetField`
filters a fixed in-memory list (stages, statuses, …). Both show loading / empty
("No matches") / error-with-retry, 44px rows, and an optional "+ Create new" row.
```tsx
<PickerSheetField
  label="Account" value={account} onChange={setAccount}
  fetchOptions={q => fetch(`/api/accounts?q=${q}`).then(r => r.json())}
  onCreate={name => router.push(`/parties/companies/new?name=${name}`)}
/>
<StaticPickerSheetField label="Stage" value={stage} onChange={setStage}
  options={stages.map(s => ({ id: s.id, label: s.name }))} />
```

## Contact actions — `src/components/ui/contact-actions.tsx`
```tsx
<PhoneContactActionsSheet open={open} onOpenChange={setOpen} phone={contact.phone} />
```
Call / WhatsApp / Copy for a phone number, Directions / Copy for an address.

## Photo capture — `src/components/ui/photo-capture.tsx`
§41.16 rules 1–6: "Take photo" / "Choose from gallery", client-side resize to
≤1600px long side (JPEG ~0.8) before upload, thumbnail with its own progress,
auto-retry ×3 then a Retry button, tap-to-view full screen via `Sheet`, remove.
Generic over `upload: (file: Blob) => Promise<{ url }>`; `uploadExpensePhoto`
matches `POST /api/expenses/upload`. Camera permission denial falls back to the
gallery with an inline "how to allow it" message (§41.16 rule 3).
```tsx
const [photos, setPhotos] = useState<CapturedPhoto[]>([])
<PhotoCapture photos={photos} onChange={setPhotos} label="Receipt" max={3} />
// onAdd(): photos.filter(p => p.status === 'done').map(p => p.url)
```

## Record summary / connection banner — pre-existing, unchanged
`src/components/ui/record-summary.tsx`, `src/components/ui/connection-banner.tsx`.

## KIT GAP (blocking, not ours to fix) — `bottom-keyboard-inset` never resolves

`src/components/ui/sheet.tsx`'s `SheetContent` positions every phone bottom
sheet and full-screen layer with the Tailwind v4 utility class
`bottom-keyboard-inset` (and `top-0 bottom-keyboard-inset` for the screen
presentation). That utility only resolves if `--keyboard-inset` is
registered under Tailwind's **spacing** namespace, i.e. defined in
`globals.css` as `--spacing-keyboard-inset: 0px`. It is instead defined as
plain `--keyboard-inset: 0px` (`src/app/globals.css:227`), so Tailwind drops
the class as unrecognized and the sheet gets `position: fixed` with no
`bottom` at all — it falls back to its static flow position, which (being
portalled to the end of `<body>`) sits below the last pixel of page content,
off-screen.

Confirmed in headless Chrome: opening `PickerSheetField` on `/orders/new` or
`BottomSheet`-based sheets (e.g. the + sheet on `/today`) shows only the
backdrop — `getComputedStyle` on `[data-slot=sheet-content]` reports
`position: fixed; bottom: -759.59px` (exactly minus its own height) with
`display: flex` and `opacity: 1`, i.e. rendered and "open" per the DOM/React
state, but entirely below the viewport. History/back-close, swipe, and
focus all still work correctly (confirmed via `history.back()` closing the
sheet and returning to the same route) — only the visual position is wrong.

This affects **every** phone bottom sheet and full-screen sheet in the app,
not just the ones rebuilt this round (`bottom-sheet.tsx`, `picker-sheet.tsx`,
`contact-actions.tsx`, `photo-capture.tsx`'s full-screen viewer, any
`Sheet`/`SheetContent` usage anywhere) — it is a one-line fix in
`src/app/globals.css`, not in any file this round owns. `sheet.tsx` is
explicitly off-limits this round (synced from the kit by sfacrm-93), and
`globals.css` is currently being edited by other agents in parallel, so
fixing it here would conflict.

It is also not just `--keyboard-inset`: `--safe-top`/`--safe-bottom`/
`--safe-left`/`--safe-right` (`globals.css:753-756`) have the same problem —
declared as plain custom properties, not under `@theme`'s `--spacing-*`
namespace, so `pt-safe-top`/`pr-safe-right`/`pb-safe-bottom`/`pl-safe-left`
(used throughout `sheet.tsx`, `dialog.tsx`, and elsewhere in the
kit-synced `components/ui`) are unrecognized Tailwind utilities too — they
compile to nothing. Grep for `grep -rn 'safe-top\|safe-bottom\|safe-left\|safe-right\|keyboard-inset' src/components/ui`
to see the full blast radius. `phone-shell.tsx` and `app-bar.tsx` (this
round) avoid it entirely by setting the safe-area padding via inline
`style={{ paddingTop: 'var(--safe-top)', … }}` instead of those utility
classes — the same workaround would unblock everything else, but the
correct fix is registering `--spacing-safe-top` etc. (and
`--spacing-keyboard-inset`) in `globals.css`'s `@theme` block so the bare
utility names resolve everywhere they're already written.
