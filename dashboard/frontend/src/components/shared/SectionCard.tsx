import { useState, type ReactNode } from 'react'

interface SectionCardProps {
  title: string
  subtitle?: string
  children: ReactNode
  tableContent?: ReactNode
  chartContent?: ReactNode
}

export function SectionCard({ title, subtitle, children, tableContent, chartContent }: SectionCardProps) {
  const [view, setView] = useState<'table' | 'chart'>('table')
  const hasToggle = tableContent && chartContent

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-5 flex-1 min-w-[300px]">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-[15px] font-semibold m-0">{title}</h3>
          {subtitle && <div className="text-[12px] text-[#8b949e] mt-1">{subtitle}</div>}
        </div>
        {hasToggle && (
          <div className="flex gap-1 bg-[#0d1117] rounded-md p-0.5">
            <button
              onClick={() => setView('table')}
              className={`px-3 py-1 text-[12px] rounded cursor-pointer border-none ${
                view === 'table' ? 'bg-[#30363d] text-[#c9d1d9]' : 'bg-transparent text-[#8b949e]'
              }`}
            >
              Table
            </button>
            <button
              onClick={() => setView('chart')}
              className={`px-3 py-1 text-[12px] rounded cursor-pointer border-none ${
                view === 'chart' ? 'bg-[#30363d] text-[#c9d1d9]' : 'bg-transparent text-[#8b949e]'
              }`}
            >
              Chart
            </button>
          </div>
        )}
      </div>
      {hasToggle ? (
        <>
          <div style={{ display: view === 'table' ? 'block' : 'none' }}>{tableContent}</div>
          <div style={{ display: view === 'chart' ? 'block' : 'none' }}>{chartContent}</div>
        </>
      ) : (
        children
      )}
    </div>
  )
}
