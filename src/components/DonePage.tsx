import { Link } from 'react-router-dom'

export default function DonePage() {
  return (
    <div className="flex min-h-screen flex-col bg-white p-6">
      <Link to="/" className="mb-4 inline-block text-sm text-slate-500 hover:text-slate-700">
        ← 返回看板
      </Link>
      <h1 className="text-lg font-semibold text-slate-800">已完成任務</h1>
      <p className="mt-4 text-sm text-slate-400">（頁面內容將於後續 Task 補完）</p>
    </div>
  )
}
