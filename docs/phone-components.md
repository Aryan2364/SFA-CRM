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
