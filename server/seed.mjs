import { listTasks, createTask } from './taskRepository.mjs'

const seedTasks = [
  { id: 'LOCAL-5', title: '議題中如果圖片太小，應該以實際尺寸顯示', priority: 'high', tags: [{ type: 'issue', label: 'Issue' }], assignees: [{ id: 'u1', name: 'Josh', avatarColor: 'bg-purple-500', initials: 'JS' }], commentCount: 1, columnId: 'todo' },
  { id: 'LOCAL-8', title: '看板卡片支援多標籤篩選', priority: 'medium', tags: [{ type: 'github', label: 'GitHub' }], assignees: [{ id: 'u2', name: 'Amy', avatarColor: 'bg-orange-500', initials: 'AM' }], commentCount: 0, columnId: 'todo' },
  { id: 'LOCAL-12', title: '雲端登入與多人即時協作', priority: 'high', tags: [{ type: 'pr', label: 'PR #40' }], assignees: [{ id: 'u1', name: 'Josh', avatarColor: 'bg-purple-500', initials: 'JS' }, { id: 'u3', name: 'Ken', avatarColor: 'bg-blue-500', initials: 'KN' }], progress: 65, commentCount: 3, columnId: 'in_progress' },
  { id: 'LOCAL-15', title: '暗色主題與 PR #40 收斂', priority: 'medium', tags: [{ type: 'pr', label: 'PR #40' }], assignees: [{ id: 'u3', name: 'Ken', avatarColor: 'bg-blue-500', initials: 'KN' }], progress: 30, commentCount: 2, columnId: 'in_progress' },
  { id: 'LOCAL-18', title: '任務詳情頁 Markdown 渲染優化', priority: 'low', tags: [{ type: 'issue', label: 'Issue' }], assignees: [{ id: 'u2', name: 'Amy', avatarColor: 'bg-orange-500', initials: 'AM' }], progress: 80, commentCount: 0, columnId: 'in_progress' },
  { id: 'LOCAL-21', title: '拖拉排序在行動裝置上偶爾失效', priority: 'high', tags: [{ type: 'bug', label: 'BUG' }], assignees: [{ id: 'u1', name: 'Josh', avatarColor: 'bg-purple-500', initials: 'JS' }], commentCount: 5, hasUnread: true, columnId: 'review' },
  { id: 'LOCAL-24', title: '看板欄位標題可自訂顏色', priority: 'medium', tags: [{ type: 'github', label: 'GitHub' }], assignees: [{ id: 'u2', name: 'Amy', avatarColor: 'bg-orange-500', initials: 'AM' }, { id: 'u3', name: 'Ken', avatarColor: 'bg-blue-500', initials: 'KN' }], commentCount: 2, hasUnread: true, columnId: 'review' },
  { id: 'LOCAL-27', title: '匯出看板資料為 CSV', priority: 'low', tags: [{ type: 'issue', label: 'Issue' }], assignees: [{ id: 'u1', name: 'Josh', avatarColor: 'bg-purple-500', initials: 'JS' }], commentCount: 0, columnId: 'review' },
]

async function seed() {
  const existing = await listTasks()
  if (existing.length > 0) {
    console.log('Tasks table already has data, skipping seed.')
    return
  }
  for (const task of seedTasks) {
    await createTask(task)
  }
  console.log(`Seeded ${seedTasks.length} tasks.`)
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
