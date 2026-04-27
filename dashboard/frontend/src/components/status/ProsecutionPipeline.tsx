import { useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { KpiCard } from '../shared/KpiCard'
import type { PipelineResponse } from '../../types/api'

interface Props {
  data: PipelineResponse
}

function hexToRgba(hex: string, alpha: number) {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

export function ProsecutionPipeline({ data }: Props) {
  const [glossaryOpen, setGlossaryOpen] = useState(false)
  const activeStages = data.stages.filter((s) => s.count > 0)

  // Build ECharts data for stacked horizontal bar
  const categories = activeStages.map((s) => s.name).reverse()

  // For stages without subs: single series entry
  // For stages with subs: one series per sub-segment
  const allSubNames = new Set<string>()
  activeStages.forEach((s) => s.subs.forEach((sub) => allSubNames.add(sub.name)))

  // Build series: one for "solid" (no-sub stages), one per sub-segment name
  const solidData: (number | null)[] = categories.map((cat) => {
    const stage = activeStages.find((s) => s.name === cat)!
    return stage.subs.length === 0 ? stage.count : null
  })
  const solidColors = categories.map((cat) => {
    const stage = activeStages.find((s) => s.name === cat)!
    return stage.color
  })

  const series: Record<string, unknown>[] = [{
    type: 'bar',
    stack: 'total',
    data: solidData.map((v, i) => ({
      value: v,
      itemStyle: { color: solidColors[i] },
    })),
    label: { show: true, position: 'inside', color: '#fff', fontSize: 11, formatter: (p: { value: number | null }) => p.value ? p.value.toLocaleString() : '' },
  }]

  // Sub-segment series
  const subNames = Array.from(allSubNames)
  subNames.forEach((subName, subIdx) => {
    const dataArr = categories.map((cat) => {
      const stage = activeStages.find((s) => s.name === cat)!
      const sub = stage.subs.find((s) => s.name === subName)
      return sub ? sub.count : null
    })
    const colorsArr = categories.map((cat) => {
      const stage = activeStages.find((s) => s.name === cat)!
      const alphas = [1, 0.6, 0.35]
      return hexToRgba(stage.color, alphas[subIdx] ?? 0.5)
    })

    series.push({
      type: 'bar',
      stack: 'total',
      name: subName,
      data: dataArr.map((v, i) => ({
        value: v,
        itemStyle: { color: colorsArr[i] },
      })),
      label: { show: true, position: 'inside', color: '#fff', fontSize: 10, formatter: (p: { value: number | null }) => p.value ? p.value.toLocaleString() : '' },
    })
  })

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-5 mb-6">
      <h3 className="text-[15px] font-semibold m-0 mb-1">Prosecution Pipeline</h3>
      <div className="text-[12px] text-[#8b949e] mb-4">{data.totalPending.toLocaleString()} active cases in examination</div>

      {/* Stage KPI cards */}
      <div className="flex gap-2.5 flex-wrap mb-2">
        {activeStages.slice(0, 5).map((s) => (
          <div key={s.name} className="flex-1 min-w-[110px] p-2.5 px-3.5 rounded-md bg-[#0d1117]" style={{ borderLeft: `3px solid ${s.color}` }}>
            <div className="text-[10px] text-[#8b949e] mb-0.5">{s.name}</div>
            <div className="text-[18px] font-semibold">{s.count.toLocaleString()}</div>
          </div>
        ))}
      </div>
      <div className="flex gap-2.5 flex-wrap mb-5">
        {activeStages.slice(5).map((s) => (
          <div key={s.name} className="flex-1 min-w-[110px] p-2.5 px-3.5 rounded-md bg-[#0d1117]" style={{ borderLeft: `3px solid ${s.color}` }}>
            <div className="text-[10px] text-[#8b949e] mb-0.5">{s.name}</div>
            <div className="text-[18px] font-semibold">{s.count.toLocaleString()}</div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <ReactECharts
        style={{ height: Math.max(300, activeStages.length * 40 + 60) }}
        option={{
          backgroundColor: 'transparent',
          tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
          grid: { left: 10, right: 40, top: 10, bottom: 30, containLabel: true },
          xAxis: { type: 'value', show: false },
          yAxis: {
            type: 'category',
            data: categories,
            axisLabel: { color: '#c9d1d9', fontSize: 12 },
            axisLine: { show: false },
            axisTick: { show: false },
          },
          legend: {
            show: subNames.length > 0,
            data: subNames,
            bottom: 0,
            textStyle: { color: '#8b949e', fontSize: 10 },
          },
          series,
        }}
      />

      {/* Glossary */}
      {data.glossary.length > 0 && (
        <div className="mt-4 border-t border-[#30363d] pt-3">
          <button
            onClick={() => setGlossaryOpen(!glossaryOpen)}
            className="text-[13px] font-semibold text-[#8b949e] bg-transparent border-none cursor-pointer"
          >
            {glossaryOpen ? '- ' : '+ '}Stage Definitions
          </button>
          {glossaryOpen && (
            <div className="grid grid-cols-2 gap-3 mt-3">
              {data.glossary.map((g) => (
                <div key={g.name} className="p-2.5 px-3.5 rounded-md bg-[#0d1117]" style={{ borderLeft: `3px solid ${g.color}` }}>
                  <div className="text-[12px] font-semibold mb-1" style={{ color: g.color }}>{g.name}</div>
                  {g.description.split('\n').map((line, i) => (
                    <div key={i} className="text-[11px] text-[#8b949e] leading-relaxed">{line}</div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
