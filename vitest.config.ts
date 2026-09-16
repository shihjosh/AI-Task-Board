import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    // 只掃 src/ 底下的測試檔。專案 test/ 目錄放的是後端 node:test 測試
    // （Task 1、Task 3 建立的 test/*.test.mjs），用 `node --test test/`
    // 獨立執行，不歸 vitest 管——vitest 預設 include glob 會抓到
    // test/*.mjs，兩種測試框架的語法互不相容，必須用 include 明確排除。
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
