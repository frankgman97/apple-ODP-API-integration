import ReactECharts from 'echarts-for-react'
import { typeColors } from '../../lib/theme'
import type { TrendsResponse } from '../../types/api'

interface Props {
  data: TrendsResponse
}

export function FilingTrends({ data }: Props) {
  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-5 mb-6">
      <h3 className="text-[15px] font-semibold m-0 mb-1">Filing Trends</h3>
      <div className="text-[12px] text-[#8b949e] mb-3">Applications filed by year, broken down by type</div>

      <ReactECharts
        style={{ height: 350 }}
        option={{
          backgroundColor: 'transparent',
          tooltip: { trigger: 'axis' },
          legend: {
            data: data.series.map((s) => s.type),
            top: 0,
            textStyle: { color: '#8b949e', fontSize: 11 },
          },
          grid: { left: 50, right: 20, top: 40, bottom: 40 },
          xAxis: {
            type: 'category',
            data: data.years,
            axisLabel: { color: '#8b949e', interval: 1 },
            axisLine: { lineStyle: { color: '#30363d' } },
          },
          yAxis: {
            type: 'value',
            axisLabel: { color: '#8b949e' },
            splitLine: { lineStyle: { color: '#30363d' } },
          },
          series: data.series.map((s) => ({
            name: s.type,
            type: 'bar',
            stack: 'total',
            data: s.data,
            itemStyle: { color: typeColors[s.type] || '#8b949e' },
          })),
        }}
      />
    </div>
  )
}
