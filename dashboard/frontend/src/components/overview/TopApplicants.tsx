import ReactECharts from 'echarts-for-react'
import { SectionCard } from '../shared/SectionCard'
import type { CountRow } from '../../types/api'

interface Props {
  data: CountRow[]
}

export function TopApplicants({ data }: Props) {
  const table = (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className="text-left p-2 border-b border-[#30363d] text-[12px] text-[#8b949e]">Applicant</th>
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

  const reversed = [...data].reverse()
  const chart = (
    <ReactECharts
      style={{ height: Math.max(300, data.length * 28) }}
      option={{
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        grid: { left: 10, right: 60, top: 10, bottom: 10, containLabel: true },
        xAxis: { type: 'value', show: false },
        yAxis: {
          type: 'category',
          data: reversed.map((r) => r.name || '(blank)'),
          axisLabel: { color: '#c9d1d9', fontSize: 11 },
          axisLine: { show: false },
          axisTick: { show: false },
        },
        series: [{
          type: 'bar',
          data: reversed.map((r) => r.cnt),
          itemStyle: { color: '#58a6ff' },
          label: { show: true, position: 'right', color: '#c9d1d9', fontSize: 11, formatter: '{c}' },
        }],
      }}
    />
  )

  return <SectionCard title="Top 20 Applicants" tableContent={table} chartContent={chart}>{null}</SectionCard>
}
