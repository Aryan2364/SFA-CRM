/**
 * The columns of the companies bulk importer, shared by `bulk-import`, by the
 * upload dialog and (for its labels) by `bulk-template`. Pure: safe in a
 * client bundle.
 *
 * Matching is by header through `matchColumns`, never by column position: a
 * sheet with a column inserted, removed or reordered used to import every
 * value one field to the side. `normaliseHeader` drops the template's `*` and
 * its "(YYYY-MM-DD)" hint, so the template's own headers resolve as written.
 *
 * The snake_case field names are aliases too — they normalise to the labels
 * or are listed below — so a caller still posting the old field-keyed rows is
 * read correctly.
 */

import type { ImportColumn } from '@/lib/bulk-import'

export const COMPANY_COLUMNS: ImportColumn[] = [
  { label: 'Name',                aliases: ['Company Name', 'Party Name'], required: true },
  { label: 'Type',                aliases: ['Company Type'], required: false },
  { label: 'Contact Person',      aliases: ['Contact Person Name', 'Contact Name'], required: false },
  { label: 'Mobile 1',            aliases: ['Mobile', 'Mobile Number', 'Mobile Number 1'], required: false },
  { label: 'Mobile 2',            aliases: ['Mobile Number 2'], required: false },
  { label: 'Email',               aliases: ['Email Address'], required: false },
  { label: 'GST Number',          aliases: ['GSTIN', 'GST'], required: false },
  { label: 'Pin Code',            aliases: ['Pincode', 'PIN'], required: false },
  { label: 'Address',             aliases: [], required: false },
  { label: 'State',               aliases: ['State Name'], required: false },
  { label: 'District',            aliases: ['District Name'], required: false },
  { label: 'Taluka',              aliases: ['Taluka Name', 'Tehsil', 'Tahsil'], required: false },
  { label: 'Stage',               aliases: [], required: false },
  { label: 'Temperature',         aliases: [], required: false },
  { label: 'Next Follow-up Date', aliases: ['Follow-up Date', 'Next Follow up'], required: false },
  { label: 'Description',         aliases: ['Notes'], required: false },
]

/** The sheet the template writes and the parser looks for first. */
export const COMPANY_SHEET = 'Companies'

/** The template's guidance sheet, with its example row. Never imported. */
export const COMPANY_NOTES_SHEET = 'How to fill'
