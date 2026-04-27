import { useState } from 'react'
import { useDatabases } from './hooks/useDatabase'
import { Header } from './components/layout/Header'
import { TabBar, type Tab } from './components/layout/TabBar'
import { OverviewTab } from './components/overview/OverviewTab'
import { StatusTab } from './components/status/StatusTab'
import { PatentsTab } from './components/patents/PatentsTab'
import { LoadingSpinner } from './components/shared/LoadingSpinner'

export default function App() {
  const { data: databases, isLoading } = useDatabases()
  const [selectedDb, setSelectedDb] = useState('')
  const [activeTab, setActiveTab] = useState<Tab>('overview')

  // Set default db once databases load
  if (databases && databases.length > 0 && !selectedDb) {
    setSelectedDb(databases[0].name)
  }

  if (isLoading) return <LoadingSpinner />
  if (!databases?.length) return <div className="p-10 text-[#8b949e]">No databases found in data/ directory</div>

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#c9d1d9]" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <Header databases={databases} selectedDb={selectedDb} onDbChange={setSelectedDb} />
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="p-6 px-8">
        {activeTab === 'overview' && <OverviewTab db={selectedDb} />}
        {activeTab === 'status' && <StatusTab db={selectedDb} />}
        {activeTab === 'patents' && <PatentsTab db={selectedDb} />}
      </div>
    </div>
  )
}
