import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { listTasks, createTask, updateTask, deleteTask } from './taskRepository.mjs'
import { listComments, createComment, updateComment, deleteComment } from './commentRepository.mjs'
import { triggerAutomation } from './automationRunner.mjs'
import { listAutomationRuns } from './automationRunRepository.mjs'
import { listAvailableSkills } from './skillsRepository.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(__dirname, '..', 'dist')

const VALID_PRIORITIES = ['high', 'medium', 'low']
const VALID_COLUMN_IDS = ['todo', 'in_progress', 'review', 'done']
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
  'targetPath',
  'automationStatus',
  'automationSkill',
  'dueDate',
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
  if (body.title !== undefined && typeof body.title === 'string' && body.title.length > 500) {
    return 'title must be 500 characters or fewer'
  }
  if (
    body.description !== undefined &&
    typeof body.description === 'string' &&
    body.description.length > 50000
  ) {
    return 'description must be 50000 characters or fewer'
  }
  return null
}

const MAX_COMMENT_LENGTH = 5000

function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) {
    // Still run a timingSafeEqual against a same-length buffer to avoid
    // leaking length information via early-return timing differences.
    crypto.timingSafeEqual(bufA, bufA)
    return false
  }
  return crypto.timingSafeEqual(bufA, bufB)
}

function createBasicAuthMiddleware() {
  const expectedUser = process.env.AUTH_USER
  const expectedPass = process.env.AUTH_PASS

  if (!expectedUser && !expectedPass) {
    console.warn(
      '[auth] AUTH_USER / AUTH_PASS 未設定，Basic Auth 保護已停用（僅限本機開發使用，切勿在對外環境這樣部署）。',
    )
    return (req, res, next) => next()
  }

  return (req, res, next) => {
    const header = req.headers.authorization ?? ''
    const [scheme, encoded] = header.split(' ')

    if (scheme === 'Basic' && encoded) {
      let decoded = ''
      try {
        decoded = Buffer.from(encoded, 'base64').toString('utf8')
      } catch {
        decoded = ''
      }
      const separatorIndex = decoded.indexOf(':')
      if (separatorIndex !== -1) {
        const user = decoded.slice(0, separatorIndex)
        const pass = decoded.slice(separatorIndex + 1)
        if (
          timingSafeStringEqual(user, expectedUser ?? '') &&
          timingSafeStringEqual(pass, expectedPass ?? '')
        ) {
          return next()
        }
      }
    }

    res.set('WWW-Authenticate', 'Basic realm="AI Task Board"')
    return res.status(401).json({ error: 'unauthorized' })
  }
}

const app = express()
app.use(express.json({ limit: '1mb' }))
app.use(createBasicAuthMiddleware())

app.get('/api/tasks', async (req, res, next) => {
  try {
    res.json({ tasks: await listTasks() })
  } catch (err) {
    next(err)
  }
})

app.post('/api/tasks', async (req, res, next) => {
  try {
    const { title, priority, columnId } = req.body ?? {}
    if (!title || !priority || !columnId) {
      return res.status(400).json({ error: 'title, priority, and columnId are required' })
    }
    const validationError = validateTaskFields(req.body ?? {})
    if (validationError) {
      return res.status(400).json({ error: validationError })
    }
    const task = await createTask(pickFields(req.body, CREATABLE_FIELDS))
    res.status(201).json({ task })
  } catch (err) {
    next(err)
  }
})

app.patch('/api/tasks/:id', async (req, res, next) => {
  try {
    const validationError = validateTaskFields(req.body ?? {})
    if (validationError) {
      return res.status(400).json({ error: validationError })
    }
    const tasks = await listTasks()
    const existing = tasks.find((t) => t.id === req.params.id)
    const task = await updateTask(req.params.id, pickFields(req.body, CREATABLE_FIELDS))
    if (!task) return res.status(404).json({ error: 'not_found' })
    res.json({ task })

    const enteringInProgress =
      existing && existing.columnId !== 'in_progress' && task.columnId === 'in_progress'
    if (enteringInProgress) {
      triggerAutomation(task).catch((err) => {
        console.error('triggerAutomation failed:', err)
      })
    }
  } catch (err) {
    next(err)
  }
})

app.delete('/api/tasks/:id', async (req, res, next) => {
  try {
    const ok = await deleteTask(req.params.id)
    if (!ok) return res.status(404).json({ error: 'not_found' })
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

app.post('/api/tasks/:id/retry-automation', async (req, res, next) => {
  try {
    const tasks = await listTasks()
    const task = tasks.find((t) => t.id === req.params.id)
    if (!task) return res.status(404).json({ error: 'not_found' })
    triggerAutomation(task).catch((err) => {
      console.error('triggerAutomation failed:', err)
    })
    res.status(202).json({ task })
  } catch (err) {
    next(err)
  }
})

app.get('/api/tasks/:taskId/comments', async (req, res, next) => {
  try {
    res.json({ comments: await listComments(req.params.taskId) })
  } catch (err) {
    next(err)
  }
})

app.get('/api/tasks/:taskId/automation-runs', async (req, res, next) => {
  try {
    res.json({ runs: await listAutomationRuns(req.params.taskId) })
  } catch (err) {
    next(err)
  }
})

app.get('/api/skills', (req, res) => {
  res.json({ skills: listAvailableSkills() })
})

app.post('/api/tasks/:taskId/comments', async (req, res, next) => {
  try {
    const content = (req.body?.content ?? '').trim()
    if (!content) {
      return res.status(400).json({ error: 'content is required' })
    }
    if (content.length > MAX_COMMENT_LENGTH) {
      return res
        .status(400)
        .json({ error: `content must be ${MAX_COMMENT_LENGTH} characters or fewer` })
    }
    const comment = await createComment(req.params.taskId, content)
    res.status(201).json({ comment })
  } catch (err) {
    next(err)
  }
})

app.patch('/api/comments/:id', async (req, res, next) => {
  try {
    const content = (req.body?.content ?? '').trim()
    if (!content) {
      return res.status(400).json({ error: 'content is required' })
    }
    if (content.length > MAX_COMMENT_LENGTH) {
      return res
        .status(400)
        .json({ error: `content must be ${MAX_COMMENT_LENGTH} characters or fewer` })
    }
    const comment = await updateComment(req.params.id, content)
    if (!comment) return res.status(404).json({ error: 'not_found' })
    res.json({ comment })
  } catch (err) {
    next(err)
  }
})

app.delete('/api/comments/:id', async (req, res, next) => {
  try {
    const ok = await deleteComment(req.params.id)
    if (!ok) return res.status(404).json({ error: 'not_found' })
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get(/^\/(?!api).*/, (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ error: 'request body too large' })
  }
  console.error('Unhandled error in API request:', err)
  res.status(500).json({ error: 'internal_server_error' })
})

export default app
