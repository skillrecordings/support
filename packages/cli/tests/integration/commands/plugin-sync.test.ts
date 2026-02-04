import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContext } from '../../helpers/test-context'

// Import the module under test
import {
  PLUGIN_DIR,
  type PluginManifest,
  generatePluginManifest,
  generateSkillDoc,
  syncPlugin,
} from '../../../src/commands/plugin-sync'

describe('plugin-sync', () => {
  describe('generatePluginManifest', () => {
    it('returns a valid PluginManifest shape', () => {
      const manifest = generatePluginManifest()

      expect(manifest.name).toBe('skill-cli-front-inbox-manager')
      expect(manifest.version).toBeDefined()
      expect(typeof manifest.version).toBe('string')
      expect(manifest.description).toContain('Front')
      expect(manifest.skills).toBeInstanceOf(Array)
      expect(manifest.skills.length).toBeGreaterThan(0)
    })

    it('includes front-inbox-manager skill', () => {
      const manifest = generatePluginManifest()
      const skill = manifest.skills.find((s) => s.id === 'front-inbox-manager')

      expect(skill).toBeDefined()
      expect(skill!.name).toBeDefined()
      expect(skill!.commands).toBeInstanceOf(Array)
      expect(skill!.commands.length).toBeGreaterThan(0)
    })

    it('lists all front commands in skills.commands', () => {
      const manifest = generatePluginManifest()
      const skill = manifest.skills.find((s) => s.id === 'front-inbox-manager')!

      const commandNames = skill.commands.map((c) => c.name)

      // Core front commands must be listed
      expect(commandNames).toContain('front inbox')
      expect(commandNames).toContain('front message')
      expect(commandNames).toContain('front conversation')
      expect(commandNames).toContain('front triage')
      expect(commandNames).toContain('front report')
      expect(commandNames).toContain('front archive')
      expect(commandNames).toContain('front bulk-archive')
      expect(commandNames).toContain('front tags list')
      expect(commandNames).toContain('front tags cleanup')
      expect(commandNames).toContain('front teammates')
      expect(commandNames).toContain('front pull')
    })

    it('each command has name and description', () => {
      const manifest = generatePluginManifest()
      const skill = manifest.skills.find((s) => s.id === 'front-inbox-manager')!

      for (const cmd of skill.commands) {
        expect(cmd.name).toBeTruthy()
        expect(typeof cmd.name).toBe('string')
        expect(cmd.description).toBeTruthy()
        expect(typeof cmd.description).toBe('string')
      }
    })

    it('includes inbox aliases in metadata', () => {
      const manifest = generatePluginManifest()
      const skill = manifest.skills.find((s) => s.id === 'front-inbox-manager')!

      expect(skill.metadata).toBeDefined()
      expect(skill.metadata!.inboxAliases).toBeDefined()

      const aliases = skill.metadata!.inboxAliases!
      // Must have the core products
      expect(aliases['total-typescript']).toBe('inb_3srbb')
      expect(aliases['ai-hero']).toBe('inb_4bj7r')
      expect(aliases['epic-web']).toBe('inb_jqs2t')
      expect(aliases['pro-tailwind']).toBe('inb_3pqh3')
    })
  })

  describe('generateSkillDoc', () => {
    it('returns a string with 300+ lines', () => {
      const doc = generateSkillDoc()

      expect(typeof doc).toBe('string')
      const lines = doc.split('\n')
      expect(lines.length).toBeGreaterThanOrEqual(300)
    })

    it('includes YAML frontmatter', () => {
      const doc = generateSkillDoc()

      expect(doc.startsWith('---\n')).toBe(true)
      expect(doc).toContain('name: skill-cli-front-inbox-manager')
      expect(doc).toContain('description:')
    })

    it('includes inbox alias table', () => {
      const doc = generateSkillDoc()

      // Table headers
      expect(doc).toContain('| Alias')
      expect(doc).toContain('| Inbox ID')

      // Key products
      expect(doc).toContain('total-typescript')
      expect(doc).toContain('inb_3srbb')
      expect(doc).toContain('ai-hero')
      expect(doc).toContain('inb_4bj7r')
      expect(doc).toContain('epic-web')
      expect(doc).toContain('pro-tailwind')
    })

    it('includes all command reference sections', () => {
      const doc = generateSkillDoc()

      expect(doc).toContain('## Command Reference')
      expect(doc).toContain('### `skill front inbox`')
      expect(doc).toContain('### `skill front message`')
      expect(doc).toContain('### `skill front conversation`')
      expect(doc).toContain('### `skill front triage`')
      expect(doc).toContain('### `skill front report`')
      expect(doc).toContain('### `skill front archive`')
      expect(doc).toContain('### `skill front bulk-archive`')
      expect(doc).toContain('### `skill front tags`')
      expect(doc).toContain('### `skill front pull`')
      expect(doc).toContain('### `skill front teammates`')
    })

    it('includes HATEOAS chaining rules', () => {
      const doc = generateSkillDoc()

      expect(doc).toContain('HATEOAS')
      expect(doc).toContain('_links')
      expect(doc).toContain('_actions')
      expect(doc).toContain('_type')
    })

    it('includes daily briefing workflow', () => {
      const doc = generateSkillDoc()

      expect(doc).toContain('Daily Briefing')
      expect(doc).toContain('skill front inbox')
      expect(doc).toContain('skill front report')
      expect(doc).toContain('skill front triage')
    })

    it('includes environment requirements', () => {
      const doc = generateSkillDoc()

      expect(doc).toContain('FRONT_API_TOKEN')
      expect(doc).toContain('Environment')
    })
  })

  describe('syncPlugin', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = join(tmpdir(), `plugin-sync-test-${Date.now()}`)
      mkdirSync(tempDir, { recursive: true })
    })

    afterEach(() => {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('writes plugin.json to target directory', async () => {
      const { ctx, getStdout } = await createTestContext({ format: 'text' })

      await syncPlugin(ctx, { outputDir: tempDir })

      const pluginPath = join(tempDir, 'plugin.json')
      expect(existsSync(pluginPath)).toBe(true)

      const content = JSON.parse(readFileSync(pluginPath, 'utf-8'))
      expect(content.name).toBe('skill-cli-front-inbox-manager')
      expect(content.skills).toBeInstanceOf(Array)
    })

    it('writes SKILL.md to target directory', async () => {
      const { ctx } = await createTestContext({ format: 'text' })

      await syncPlugin(ctx, { outputDir: tempDir })

      const skillPath = join(tempDir, 'SKILL.md')
      expect(existsSync(skillPath)).toBe(true)

      const content = readFileSync(skillPath, 'utf-8')
      expect(content).toContain('# Skill CLI Front Inbox Manager')
      expect(content.split('\n').length).toBeGreaterThanOrEqual(300)
    })

    it('outputs JSON summary when --json is set', async () => {
      const { ctx, getStdout } = await createTestContext({ format: 'json' })

      await syncPlugin(ctx, { outputDir: tempDir, json: true })

      const stdout = getStdout()
      const payload = JSON.parse(stdout)
      expect(payload._type).toBe('plugin-sync-result')
      expect(payload.data.files).toHaveLength(2)
      expect(payload.data.pluginName).toBe('skill-cli-front-inbox-manager')
    })

    it('outputs human-readable summary for text format', async () => {
      const { ctx, getStdout } = await createTestContext({ format: 'text' })

      await syncPlugin(ctx, { outputDir: tempDir })

      const stdout = getStdout()
      expect(stdout).toContain('plugin.json')
      expect(stdout).toContain('SKILL.md')
      expect(stdout).toContain('synced')
    })

    it('creates output directory if it does not exist', async () => {
      const nestedDir = join(tempDir, 'nested', 'deep')
      const { ctx } = await createTestContext({ format: 'text' })

      await syncPlugin(ctx, { outputDir: nestedDir })

      expect(existsSync(join(nestedDir, 'plugin.json'))).toBe(true)
      expect(existsSync(join(nestedDir, 'SKILL.md'))).toBe(true)
    })

    it('overwrites existing files on re-sync', async () => {
      const pluginPath = join(tempDir, 'plugin.json')
      writeFileSync(pluginPath, '{"old": true}')

      const { ctx } = await createTestContext({ format: 'text' })
      await syncPlugin(ctx, { outputDir: tempDir })

      const content = JSON.parse(readFileSync(pluginPath, 'utf-8'))
      expect(content.old).toBeUndefined()
      expect(content.name).toBe('skill-cli-front-inbox-manager')
    })

    it('defaults outputDir to PLUGIN_DIR', async () => {
      // Just verify PLUGIN_DIR is the right relative path
      expect(PLUGIN_DIR).toContain('plugin')
    })
  })

  describe('plugin.json schema validation', () => {
    it('version follows semver', () => {
      const manifest = generatePluginManifest()
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/)
    })

    it('skills have unique ids', () => {
      const manifest = generatePluginManifest()
      const ids = manifest.skills.map((s) => s.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('commands have unique names within a skill', () => {
      const manifest = generatePluginManifest()
      for (const skill of manifest.skills) {
        const names = skill.commands.map((c) => c.name)
        expect(new Set(names).size).toBe(names.length)
      }
    })
  })
})
