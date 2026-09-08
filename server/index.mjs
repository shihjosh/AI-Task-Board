import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { listTasks, createTask, updateTask, deleteTask } from './taskRepository.mjs'
import { listComments, createComment, updateComment, deleteComment } from './commentRepository.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(__dirname, '..', 'dist')

const VALID_PRIORITIES = ['high', 'medium', 'low']
const VALID_COLUMN_IDS = ['todo', 'in_progress', 'review']
const CREATABLE_FIELDS = [
  'title',
  'priority',
  'tags',
  'assignees',
  'progress',
  'commentCount',
  'hasUnread',
  'columnId',
  'description',
]

function pickFields(source, fields) {
  const result = {}
  for (const field of fields) {
    if (source && Object.prototype.hasOwnProperty.call(source, field)) {
      result[field] = source[field]
    }
  }
  return result
}

function validateTaskFields(body) {
  if (body.priority !== undefined && !VALID_PRIORITIES.includes(body.priority)) {
    return `priority must be one of: ${VALID_PRIORITIES.join(', ')}`
  }
  if (body.columnId !== undefined && !VALID_COLUMN_IDS.includes(body.columnId)) {
    return `columnId must be one of: ${VALID_COLUMN_IDS.join(', ')}`
  }
  if (
    body.progress !== undefined &&
    (typeof body.progress !== 'number' || body.progress < 0 || body.progress > 100)
  ) {
    return 'progress must be a number between 0 and 100'
  }
  return null
}

const app = express()
app.use(express.json())

app.get('/api/tasks', (req, res) => {
  res.json({ tasks: listTasks() })
})

app.post('/api/tasks', (req, res) => {
  const { title, priority, columnId } = req.body ?? {}
  if (!title || !priority || !columnId) {
    return res.status(400).json({ error: 'title, priority, and columnId are required' })
  }
  const validationError = validateTaskFields(req.body ?? {})
  if (validationError) {
    return res.status(400).json({ error: validationError })
  }
  const task = createTask(pickFields(req.body, CREATABLE_FIELDS))
  res.status(201).json({ task })
})

app.patch('/api/tasks/:id', (req, res) => {
  const validationError = validateTaskFields(req.body ?? {})
  if (validationError) {
    return res.status(400).json({ error: validationError })
  }
  const task = updateTask(req.params.id, pickFields(req.body, CREATABLE_FIELDS))
  if (!task) return res.status(404).json({ error: 'not_found' })
  res.json({ task })
})

app.delete('/api/tasks/:id', (req, res) => {
  const ok = deleteTask(req.params.id)
  if (!ok) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})

app.get('/api/tasks/:taskId/comments', (req, res) => {
  res.json({ comments: listComments(req.params.taskId) })
})

app.post('/api/tasks/:taskId/comments', (req, res) => {
  const content = (req.body?.content ?? '').trim()
  if (!content) {
    return res.status(400).json({ error: 'content is required' })
  }
  const comment = createComment(req.params.taskId, content)
  res.status(201).json({ comment })
})

app.patch('/api/comments/:id', (req, res) => {
  const content = (req.body?.content ?? '').trim()
  if (!content) {
    return res.status(400).json({ error: 'content is required' })
  }
  const comment = updateComment(req.params.id, content)
  if (!comment) return res.status(404).json({ error: 'not_found' })
  res.json({ comment })
})

app.delete('/api/comments/:id', (req, res) => {
  const ok = deleteComment(req.params.id)
  if (!ok) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get(/^\/(?!api).*/, (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

app.use((err, req, res, next) => {
  console.error('Unhandled error in API request:', err)
  res.status(500).json({ error: 'internal_server_error' })
})

const port = process.env.PORT ?? 3001
app.listen(port, () => {
  console.log(`API server listening on port ${port}`)
})
