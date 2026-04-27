import ReactECharts from 'echarts-for-react'
import { SectionCard } from '../shared/SectionCard'
import { typeColors } from '../../lib/theme'
import type { CountRow } from '../../types/api'

interface Props {
  data: CountRow[]
}

export function AppTypeBreakdown({ data }: Props) {
  const table = (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className="text-left p-2 border-b border-[#30363d] text-[12px] text-[#8b949e]">Type</th>
          <th className="text-right p-2 border-b border-[#30363d] text-[12px] text-[#8b949e]">Count</th>
          <th className="text-right p-2 border-b border-[#30363d] text-[12px] text-[#8b949e]">%</th>
        </tr>
      </thead>
      <tbody>
        {data.map((r) => (
          <tr key={r.name}>
            <td className="p-1.5 px-2 border-b border-[#30363d] text-[13px]">{r.name || '(blank)'}</td>
            <td className="text-right p-1.5 px-2 border-b border-[#30363d] text-[13px]">{r.cnt.toLocaleString()}</td>
            <td className="text-right p-1.5 px-2 border-b border-[#30363d] text-[13px] text-[#8b949e]">{r.pct.toFixed(1)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  const chart = (
    <ReactECharts
      style={{ height: 350 }}
      option={{
        backgroundColor: 'transparent',
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        series: [{
          type: 'pie',
          radius: ['40%', '70%'],
          label: { color: '#c9d1d9', fontSize: 11 },
          data: data.map((r) => ({
            name: r.name || '(blank)',
            value: r.cnt,
            itemStyle: { color: typeColors[r.name || ''] || '#8b949e' },
          })),
        }],
      }}
    />
  )

  return <SectionCard title="By Application Type" tableContent={table} chartContent={chart}>{null}</SectionCard>
}
