export type Tab = 'overview' | 'status' | 'patents'

interface TabBarProps {
  activeTab: Tab
  onTabChange: (tab: Tab) => void
}

const tabs: { value: Tab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'status', label: 'Status' },
  { value: 'patents', label: 'Patents' },
]

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
  return (
    <div className="px-8 border-b border-[#30363d] flex">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onTabChange(tab.value)}
          className={`px-5 py-3 text-[14px] border-none bg-transparent cursor-pointer ${
            activeTab === tab.value
              ? 'text-[#c9d1d9] border-b-2 border-b-[#58a6ff]'
              : 'text-[#8b949e] border-b-2 border-b-transparent'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
