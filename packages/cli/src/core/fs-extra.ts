import { existsSync } from 'node:fs'
import { cp, mkdir, readFile } from 'node:fs/promises'

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

export async function pathExists(path: string): Promise<boolean> {
  return existsSync(path)
}

export async function readJson(path: string): Promise<unknown> {
  const contents = await readFile(path, 'utf-8')
  return JSON.parse(contents)
}

export async function copy(src: string, dest: string): Promise<void> {
  await cp(src, dest, { recursive: true, force: true })
}
