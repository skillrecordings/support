import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverSkills } from './list'

const TEST_SKILLS_DIR = join(process.cwd(), '.test-skills')

describe('discoverSkills', () => {
  beforeEach(() => {
    if (existsSync(TEST_SKILLS_DIR)) {
      rmSync(TEST_SKILLS_DIR, { recursive: true })
    }
    mkdirSync(TEST_SKILLS_DIR, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_SKILLS_DIR)) {
      rmSync(TEST_SKILLS_DIR, { recursive: true })
    }
  })

  it('returns empty array when skills directory does not exist', () => {
    const skills = discoverSkills(join(TEST_SKILLS_DIR, 'nonexistent'))
    expect(skills).toEqual([])
  })

  it('returns empty array when skills directory is empty', () => {
    const skills = discoverSkills(TEST_SKILLS_DIR)
    expect(skills).toEqual([])
  })

  it('discovers skill with simple description', () => {
    const skillDir = join(TEST_SKILLS_DIR, 'test-skill')
    mkdirSync(skillDir)
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '# Test Skill\n\nThis is a test skill description.\n\nMore content here.'
    )

    const skills = discoverSkills(TEST_SKILLS_DIR)
    expect(skills).toEqual([
      {
        name: 'test-skill',
        description: 'This is a test skill description.',
        path: join(skillDir, 'SKILL.md'),
      },
    ])
  })

  it('extracts description from first paragraph after heading', () => {
    const skillDir = join(TEST_SKILLS_DIR, 'complex-skill')
    mkdirSync(skillDir)
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '# Complex Skill\n\nFirst paragraph is the description.\n\nSecond paragraph is ignored.'
    )

    const skills = discoverSkills(TEST_SKILLS_DIR)
    expect(skills).toHaveLength(1)
    expect(skills[0]?.description).toBe('First paragraph is the description.')
  })

  it('handles multiple skills in directory', () => {
    const skill1Dir = join(TEST_SKILLS_DIR, 'skill-one')
    const skill2Dir = join(TEST_SKILLS_DIR, 'skill-two')
    mkdirSync(skill1Dir)
    mkdirSync(skill2Dir)

    writeFileSync(join(skill1Dir, 'SKILL.md'), '# Skill One\n\nFirst skill.\n')
    writeFileSync(join(skill2Dir, 'SKILL.md'), '# Skill Two\n\nSecond skill.\n')

    const skills = discoverSkills(TEST_SKILLS_DIR)
    expect(skills).toHaveLength(2)
    expect(skills.map((s) => s.name).sort()).toEqual(['skill-one', 'skill-two'])
  })

  it('skips directories without SKILL.md', () => {
    const withSkill = join(TEST_SKILLS_DIR, 'with-skill')
    const withoutSkill = join(TEST_SKILLS_DIR, 'without-skill')
    mkdirSync(withSkill)
    mkdirSync(withoutSkill)

    writeFileSync(join(withSkill, 'SKILL.md'), '# With Skill\n\nHas SKILL.md\n')
    writeFileSync(join(withoutSkill, 'README.md'), 'No SKILL.md here')

    const skills = discoverSkills(TEST_SKILLS_DIR)
    expect(skills).toHaveLength(1)
    expect(skills[0]?.name).toBe('with-skill')
  })

  it('handles skill with no description after heading', () => {
    const skillDir = join(TEST_SKILLS_DIR, 'no-desc')
    mkdirSync(skillDir)
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '# No Description\n\n## Section\n\nContent'
    )

    const skills = discoverSkills(TEST_SKILLS_DIR)
    expect(skills).toHaveLength(1)
    expect(skills[0]?.description).toBe('')
  })

  it('handles skill with only heading', () => {
    const skillDir = join(TEST_SKILLS_DIR, 'heading-only')
    mkdirSync(skillDir)
    writeFileSync(join(skillDir, 'SKILL.md'), '# Heading Only')

    const skills = discoverSkills(TEST_SKILLS_DIR)
    expect(skills).toHaveLength(1)
    expect(skills[0]?.description).toBe('')
  })

  it('trims whitespace from description', () => {
    const skillDir = join(TEST_SKILLS_DIR, 'whitespace')
    mkdirSync(skillDir)
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '# Whitespace\n\n   Trimmed description.   \n\n'
    )

    const skills = discoverSkills(TEST_SKILLS_DIR)
    expect(skills).toHaveLength(1)
    expect(skills[0]?.description).toBe('Trimmed description.')
  })

  it('handles frontmatter metadata gracefully', () => {
    const skillDir = join(TEST_SKILLS_DIR, 'with-frontmatter')
    mkdirSync(skillDir)
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: with-frontmatter\n---\n\n# With Frontmatter\n\nDescription after frontmatter.\n'
    )

    const skills = discoverSkills(TEST_SKILLS_DIR)
    expect(skills).toHaveLength(1)
    expect(skills[0]?.description).toBe('Description after frontmatter.')
  })
})
