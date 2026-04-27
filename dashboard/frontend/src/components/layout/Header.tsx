import type { DatabaseInfo } from '../../types/api'

interface HeaderProps {
  databases: DatabaseInfo[]
  selectedDb: string
  onDbChange: (db: string) => void
}

export function Header({ databases, selectedDb, onDbChange }: HeaderProps) {
  return (
    <div className="px-8 py-5 border-b border-[#30363d] flex items-center gap-6">
      <h1 className="m-0 text-[20px] font-semibold text-[#c9d1d9]">Patent Explorer</h1>
      <select
        value={selectedDb}
        onChange={(e) => onDbChange(e.target.value)}
        className="w-[360px] bg-[#161b22] border border-[#30363d] rounded-md px-3 py-2 text-[14px] text-[#c9d1d9] outline-none focus:border-[#58a6ff]"
      >
        {databases.map((db) => (
          <option key={db.name} value={db.name}>
            {db.label}
          </option>
        ))}
      </select>
    </div>
  )
}
