interface KpiCardProps {
  title: string
  value: string | number
  subtitle?: string
  borderColor?: string
  valueColor?: string
}

export function KpiCard({ title, value, subtitle, borderColor, valueColor }: KpiCardProps) {
  const formatted = typeof value === 'number' ? value.toLocaleString() : value
  return (
    <div
      className="bg-[#161b22] border border-[#30363d] rounded-lg p-5 flex-1 min-w-[180px]"
      style={borderColor ? { borderColor } : undefined}
    >
      <div className="text-[13px] text-[#8b949e] mb-2 uppercase tracking-wide">{title}</div>
      <div className="text-[28px] font-semibold" style={valueColor ? { color: valueColor } : undefined}>
        {formatted}
      </div>
      {subtitle && <div className="text-[12px] text-[#8b949e] mt-1">{subtitle}</div>}
    </div>
  )
}
