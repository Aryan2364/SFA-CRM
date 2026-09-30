/**
 * The columns of the two master importers, shared by the routes and by the
 * import page so that what the page previews and pre-checks is exactly what
 * the server accepts. Pure: no server imports, safe in a client bundle.
 *
 * Header matching itself lives in `@/lib/bulk-import`, with the rest of the
 * contract the companies importer shares.
 */

import type { ImportColumn } from '@/lib/bulk-import'

export const LOCATION_COLUMNS: ImportColumn[] = [
  { label: 'State',    aliases: ['State Name'],    required: true },
  { label: 'District', aliases: ['District Name'], required: false },
  { label: 'Taluka',   aliases: ['Taluka Name', 'Tehsil', 'Tahsil'], required: false },
  { label: 'Village',  aliases: ['Village Name'],  required: false },
]

export const PRODUCT_COLUMNS: ImportColumn[] = [
  { label: 'Category',     aliases: ['Category Name', 'Product Category'], required: true },
  { label: 'Sub-Category', aliases: ['Subcategory', 'Sub Category Name', 'Product Sub-Category'], required: false },
  { label: 'Product Name', aliases: ['Product'], required: false },
  { label: 'Price',        aliases: ['Rate', 'MRP'], required: false },
  { label: 'SKU',          aliases: ['SKU Code'], required: false },
]
