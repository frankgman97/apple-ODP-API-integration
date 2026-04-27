import ReactECharts from 'echarts-for-react'
import { KpiCard } from '../shared/KpiCard'
import type { GrantsResponse } from '../../types/api'

interface Props {
  data: GrantsResponse
}

export function GrantAnalysis({ data }: Props) {
  const grantRateOption = {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', formatter: '{b}: {c}%' },
    grid: { left: 50, right: 20, top: 30, bottom: 40 },
    xAxis: {
      type: 'category' as const,
      data: data.grantRateByYear.map((r) => r.year),
      axisLabel: { color: '#c9d1d9', interval: 1 },
      axisLine: { lineStyle: { color: '#30363d' } },
    },
    yAxis: {
      type: 'value' as const,
      min: 0, max: 100,
      axisLabel: { color: '#8b949e', formatter: '{value}%' },
      splitLine: { lineStyle: { color: '#30363d' } },
    },
    series: [{
      type: 'line',
      data: data.grantRateByYear.map((r) => r.rate.toFixed(1)),
      lineStyle: { color: '#3fb950', width: 2 },
      itemStyle: { color: '#3fb950' },
      symbolSize: 6,
    }],
  }

  const ttgOption = {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis' },
    grid: { left: 50, right: 20, top: 30, bottom: 40 },
    xAxis: {
      type: 'value' as const,
      name: 'Months',
      nameLocation: 'middle' as const,
      nameGap: 25,
      axisLabel: { color: '#8b949e' },
      axisLine: { lineStyle: { color: '#30363d' } },
    },
    yAxis: {
      type: 'value' as const,
      name: 'Patents',
      axisLabel: { color: '#8b949e' },
      splitLine: { lineStyle: { color: '#30363d' } },
    },
    series: [{
      type: 'bar',
      data: data.ttgDistribution.map((b) => [b.months, b.count]),
      itemStyle: { color: '#79c0ff' },
      barWidth: 4,
    }],
  }

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-5 mb-6">
      <h3 className="text-[15px] font-semibold m-0 mb-4">Grant Analysis</h3>

      <div className="flex gap-4 flex-wrap mb-5">
        <KpiCard
          title="Grant Rate (Utility)"
          value={`${data.grantRate}%`}
          subtitle={`${data.grantedUtility.toLocaleString()} granted of ${data.totalUtility.toLocaleString()} utility filed`}
        />
        <KpiCard
          title="Avg Time to Grant"
          value={`${data.avgTimeToGrant} mo`}
          subtitle={`Based on ${data.ttgDistribution.reduce((s, b) => s + b.count, 0).toLocaleString()} granted patents`}
        />
        <KpiCard title="Total Granted" value={data.granted} subtitle="All types" />
      </div>

      <div className="flex gap-4 flex-wrap">
        <div className="flex-1 min-w-[400px]">
          <div className="text-[13px] text-[#8b949e] mb-2">Grant Rate by Filing Year (Utility)</div>
          <ReactECharts style={{ height: 300 }} option={grantRateOption} />
        </div>
        <div className="flex-1 min-w-[400px]">
          <div className="text-[13px] text-[#8b949e] mb-2">
            Time to Grant Distribution (avg {data.avgTimeToGrant} months)
          </div>
          <ReactECharts style={{ height: 300 }} option={ttgOption} />
        </div>
      </div>
    </div>
  )
}
