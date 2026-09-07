import express from 'express'
import { listTasks, createTask, updateTask, deleteTask } from './taskRepository.mjs'

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
  const task = createTask(req.body)
  res.status(201).json({ task })
})

app.patch('/api/tasks/:id', (req, res) => {
  const task = updateTask(req.params.id, req.body ?? {})
  if (!task) return res.status(404).json({ error: 'not_found' })
  res.json({ task })
})

app.delete('/api/tasks/:id', (req, res) => {
  const ok = deleteTask(req.params.id)
  if (!ok) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})

const port = process.env.PORT ?? 3001
app.listen(port, () => {
  console.log(`API server listening on port ${port}`)
})
