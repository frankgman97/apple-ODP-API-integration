import ReactECharts from 'echarts-for-react'
import { KpiCard } from '../shared/KpiCard'
import type { MaintenanceResponse } from '../../types/api'

interface Props {
  data: MaintenanceResponse
}

export function MaintenanceFees({ data }: Props) {
  const feeChartOption = {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis' },
    grid: { left: 50, right: 20, top: 10, bottom: 40 },
    xAxis: {
      type: 'category' as const,
      data: data.feesByYear.map((r) => r.year),
      axisLabel: { color: '#8b949e' },
      axisLine: { lineStyle: { color: '#30363d' } },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: { color: '#8b949e' },
      splitLine: { lineStyle: { color: '#30363d' } },
    },
    series: [{
      type: 'bar',
      data: data.feesByYear.map((r) => r.count),
      itemStyle: { color: '#d29922' },
      label: { show: true, position: 'top', color: '#c9d1d9', fontSize: 11 },
    }],
  }

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-5 mb-6">
      <h3 className="text-[15px] font-semibold m-0 mb-1">Maintenance Fees</h3>
      <div className="text-[11px] text-[#8b949e] mb-4 italic">
        Estimated fee windows -- verify with USPTO PAIR for actual payment status
      </div>

      <div className="flex gap-4 flex-wrap mb-5">
        <KpiCard title="Active Granted" value={data.activeGranted} subtitle="Patents with grant date" />
        <KpiCard
          title="FEES DUE NOW"
          value={data.feesDueNow}
          subtitle="Within 6-month payment window"
          borderColor={data.feesDueNow > 0 ? '#f85149' : undefined}
          valueColor={data.feesDueNow > 0 ? '#f85149' : undefined}
        />
        <KpiCard
          title="FEES NEXT 12 MONTHS"
          value={data.feesUpcoming}
          subtitle="Due within next year"
          borderColor={data.feesUpcoming > 0 ? '#d29922' : undefined}
          valueColor={data.feesUpcoming > 0 ? '#d29922' : undefined}
        />
        <KpiCard title="Expired (Non-Payment)" value={data.expiredNonPayment} subtitle="Lost due to maintenance fee lapse" />
      </div>

      <div className="flex gap-4 flex-wrap">
        <div className="flex-1 min-w-[400px]">
          <div className="text-[13px] text-[#8b949e] mb-2">Upcoming Maintenance Fees by Year</div>
          {data.feesByYear.length > 0 ? (
            <ReactECharts style={{ height: 280 }} option={feeChartOption} />
          ) : (
            <div className="text-[#8b949e] p-10 text-center">No upcoming fees in the next 12 months</div>
          )}
        </div>
        <div className="flex-1 min-w-[400px]">
          <div className="text-[13px] text-[#8b949e] mb-2">Next Maintenance Fees Due (Soonest First)</div>
          {data.nextFees.length > 0 ? (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="text-left p-2 border-b border-[#30363d] text-[12px] text-[#8b949e]">Patent #</th>
                  <th className="text-left p-2 border-b border-[#30363d] text-[12px] text-[#8b949e]">Fee</th>
                  <th className="text-left p-2 border-b border-[#30363d] text-[12px] text-[#8b949e]">Due Date</th>
                  <th className="text-center p-2 border-b border-[#30363d] text-[12px] text-[#8b949e]">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.nextFees.map((f, i) => (
                  <tr key={i}>
                    <td className="p-1.5 px-2 border-b border-[#30363d] text-[13px]">{f.patentNumber}</td>
                    <td className="p-1.5 px-2 border-b border-[#30363d] text-[13px]">{f.fee}</td>
                    <td className="p-1.5 px-2 border-b border-[#30363d] text-[13px]">{f.dueDate}</td>
                    <td className="text-center p-1.5 px-2 border-b border-[#30363d]">
                      <span
                        className="text-[11px] font-semibold px-2 py-0.5 rounded"
                        style={{
                          backgroundColor: f.status === 'DUE NOW' ? '#f8514933' : '#d2992233',
                          color: f.status === 'DUE NOW' ? '#f85149' : '#d29922',
                        }}
                      >
                        {f.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-[#8b949e] p-10 text-center">No fees due in the near term</div>
          )}
        </div>
      </div>
    </div>
  )
}
