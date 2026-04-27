import ReactECharts from 'echarts-for-react'
import { SectionCard } from '../shared/SectionCard'
import type { PortfolioBucket } from '../../types/api'

interface Props {
  data: PortfolioBucket[]
}

export function PortfolioOutcome({ data }: Props) {
  const table = (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className="text-left p-2 border-b border-[#30363d] text-[12px] text-[#8b949e]">Outcome</th>
          <th className="text-right p-2 border-b border-[#30363d] text-[12px] text-[#8b949e]">Count</th>
          <th className="text-right p-2 border-b border-[#30363d] text-[12px] text-[#8b949e]">%</th>
        </tr>
      </thead>
      <tbody>
        {data.map((b) => (
          <>
            <tr key={b.name} className="bg-[#1c2128]">
              <td className="p-2 border-b border-[#30363d] text-[13px]">
                <span style={{ color: b.color }} className="mr-1">&#x25CF;</span>
                <strong>{b.name}</strong>
              </td>
              <td className="text-right p-2 border-b border-[#30363d] text-[13px] font-semibold">
                {b.total.toLocaleString()}
              </td>
              <td className="text-right p-2 border-b border-[#30363d] text-[13px] font-semibold" style={{ color: b.color }}>
                {b.pct.toFixed(1)}%
              </td>
            </tr>
            {b.subs.map((sub) => (
              <tr key={`${b.name}-${sub.name}`}>
                <td className="py-1 px-2 pl-7 border-b border-[#30363d] text-[12px] text-[#8b949e]">{sub.name}</td>
                <td className="text-right py-1 px-2 border-b border-[#30363d] text-[12px]">{sub.cnt.toLocaleString()}</td>
                <td className="text-right py-1 px-2 border-b border-[#30363d] text-[12px] text-[#8b949e]">{sub.pct.toFixed(1)}%</td>
              </tr>
            ))}
          </>
        ))}
      </tbody>
    </table>
  )

  const chart = (
    <ReactECharts
      style={{ height: 380 }}
      option={{
        backgroundColor: 'transparent',
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        series: [{
          type: 'pie',
          radius: ['40%', '70%'],
          label: { color: '#c9d1d9', fontSize: 11 },
          data: data.map((b) => ({
            name: b.name,
            value: b.total,
            itemStyle: { color: b.color },
          })),
        }],
      }}
    />
  )

  return <SectionCard title="Portfolio Outcome" tableContent={table} chartContent={chart}>{null}</SectionCard>
}
