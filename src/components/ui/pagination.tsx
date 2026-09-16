interface PaginationProps {
  page: number
  totalPages: number
  onPage: (p: number) => void
  totalRows?: number
}

export default function Pagination({ page, totalPages, onPage, totalRows }: PaginationProps) {
  if (totalPages <= 1) return null
  const pages = Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
    if (totalPages <= 7) return i + 1
    if (page <= 4) return i + 1
    if (page >= totalPages - 3) return totalPages - 6 + i
    return page - 3 + i
  })

  return (
    <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
      <span>{totalRows != null ? `${totalRows} records` : ''}</span>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(page - 1)} disabled={page === 1} className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-40">← Prev</button>
        {pages.map(p => (
          <button key={p} onClick={() => onPage(p)} className={`w-8 h-8 rounded text-xs font-medium ${p === page ? 'bg-blue-600 text-white' : 'hover:bg-gray-100'}`}>{p}</button>
        ))}
        <button onClick={() => onPage(page + 1)} disabled={page === totalPages} className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-40">Next →</button>
      </div>
    </div>
  )
}
