import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function resolveSkillsDir() {
  return process.env.HERMES_HOME
    ? path.join(process.env.HERMES_HOME, 'skills')
    : path.join(os.homedir(), '.hermes', 'skills')
}

export function listAvailableSkills() {
  const skillsDir = resolveSkillsDir()
  if (!fs.existsSync(skillsDir)) return []

  const names = new Set()
  const categories = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory())
  for (const category of categories) {
    const categoryPath = path.join(skillsDir, category.name)
    const entries = fs.readdirSync(categoryPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && fs.existsSync(path.join(categoryPath, entry.name, 'SKILL.md'))) {
        names.add(entry.name)
      } else if (entry.isFile() && entry.name === 'SKILL.md') {
        // 極少數 skill 直接放在 category 目錄下（無子目錄包裝），以 category 名稱本身當作 skill 名稱
        names.add(category.name)
      }
    }
  }
  return [...names].sort()
}
