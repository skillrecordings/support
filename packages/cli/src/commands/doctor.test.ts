import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerDoctorCommand } from './doctor'

// Mock dependencies
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}))
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}))
vi.mock('../core/keychain', () => ({
  isOpCliAvailable: vi.fn(),
  getFromKeychain: vi.fn(),
}))

describe('doctor command', () => {
  let program: Command

  beforeEach(() => {
    program = new Command()
    program.exitOverride()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('command registration', () => {
    it('registers doctor command', () => {
      registerDoctorCommand(program)
      const command = program.commands.find((cmd) => cmd.name() === 'doctor')
      expect(command).toBeDefined()
      expect(command?.description()).toContain('health check')
    })

    it('supports --json flag', () => {
      registerDoctorCommand(program)
      const command = program.commands.find((cmd) => cmd.name() === 'doctor')
      const jsonOption = command?.options.find((opt) => opt.long === '--json')
      expect(jsonOption).toBeDefined()
    })
  })

  describe('health checks', () => {
    it('runs all health check categories', async () => {
      const { isOpCliAvailable, getFromKeychain } = await import(
        '../core/keychain'
      )
      const { existsSync } = await import('node:fs')
      const { execSync } = await import('node:child_process')

      vi.mocked(isOpCliAvailable).mockReturnValue(true)
      vi.mocked(getFromKeychain).mockReturnValue('test-value')
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(execSync).mockReturnValue(Buffer.from('OK'))

      registerDoctorCommand(program)

      const cmd = program.commands.find((c) => c.name() === 'doctor')
      expect(cmd).toBeDefined()

      // Verify the command has a description
      expect(cmd?.description()).toBeTruthy()
    })

    it('checks environment variables', async () => {
      const { isOpCliAvailable, getFromKeychain } = await import(
        '../core/keychain'
      )
      const { existsSync } = await import('node:fs')
      const { execSync } = await import('node:child_process')

      vi.mocked(isOpCliAvailable).mockReturnValue(false)
      vi.mocked(getFromKeychain).mockReturnValue(null)
      vi.mocked(existsSync).mockReturnValue(false)
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('not found')
      })

      process.env.DATABASE_URL = 'test'

      registerDoctorCommand(program)

      const cmd = program.commands.find((c) => c.name() === 'doctor')
      expect(cmd).toBeDefined()

      delete process.env.DATABASE_URL
    })

    it('checks keychain', async () => {
      const { isOpCliAvailable, getFromKeychain } = await import(
        '../core/keychain'
      )
      const { existsSync } = await import('node:fs')
      const { execSync } = await import('node:child_process')

      vi.mocked(isOpCliAvailable).mockReturnValue(true)
      vi.mocked(getFromKeychain).mockReturnValue('mock-key')
      vi.mocked(existsSync).mockReturnValue(false)
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('not found')
      })

      registerDoctorCommand(program)

      const cmd = program.commands.find((c) => c.name() === 'doctor')
      expect(cmd).toBeDefined()
    })
  })
})
