/**
 * Skill provider serving this package's `skills/` directory.
 *
 * A provider is required rather than `ctx.skills.register` because packaged
 * skills are files: the runtime registration form carries a body inline and
 * has no path, while a provider can hand the registry a candidate with a
 * locator and load the body on demand.
 *
 * The frontmatter grammar is the small `key: value` subset these files use, so
 * reading them needs no YAML dependency.
 *
 * @module dsh-waimai/skill-provider
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Rank that lets a package-provided skill outrank user roots; matches `BUNDLED_SKILL_RANK` in dsh-skill. */
export const SKILL_RANK = 600

/** Provider name used in diagnostics and candidate records. */
export const PROVIDER_NAME = 'dsh-waimai'

/**
 * Split a SKILL.md file into frontmatter fields and body.
 *
 * @param raw - complete file text.
 * @returns parsed fields and trimmed body, or undefined without valid frontmatter.
 */
export function parseSkillFile(raw) {
  if (typeof raw !== 'string') return undefined
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  if (raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') return undefined
  const rest = raw.slice(firstLineEnd + 1)
  // `$` in multiline mode matches before `\n`, so a CRLF file leaves `\r`
  // inside the line and the terminator must absorb it explicitly.
  const closingMatch = rest.match(/^---[ \t]*\r?$/m)
  if (closingMatch === null || closingMatch.index === undefined) return undefined
  const header = rest.slice(0, closingMatch.index)
  const body = rest.slice(closingMatch.index + closingMatch[0].length).trim()

  const fields = {}
  for (const line of header.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/)
    if (match === null) continue
    let value = match[2].trim()
    const quoted = value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    if (quoted) value = value.slice(1, -1)
    if (value.length > 0) fields[match[1]] = value
  }
  if (typeof fields.name !== 'string' || typeof fields.description !== 'string') return undefined
  return { fields, body }
}

/**
 * Read one skill directory.
 *
 * @param directory - absolute skill directory.
 * @returns the located skill, or undefined when the directory holds no readable skill.
 */
async function locateSkill(directory) {
  const path = join(directory, 'SKILL.md')
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    // A directory without a readable SKILL.md is simply not a skill.
    return undefined
  }
  const parsed = parseSkillFile(raw)
  if (parsed === undefined) return undefined
  return { path, parsed, directory }
}

/**
 * Create the provider registered on the skill registry.
 *
 * @param skillsDir - absolute directory holding one subdirectory per skill.
 * @returns the provider value.
 */
export function createSkillProvider(skillsDir) {
  return {
    name: PROVIDER_NAME,
    /**
     * List the packaged skills.
     *
     * @returns candidate summaries for every readable skill directory.
     */
    async list() {
      let entries
      try {
        entries = await readdir(skillsDir, { withFileTypes: true })
      } catch {
        // A build without the skills directory serves no skills.
        return []
      }
      const candidates = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const located = await locateSkill(join(skillsDir, entry.name))
        if (located === undefined) continue
        candidates.push(toCandidate(located))
      }
      return candidates
    },
    /**
     * Load one packaged skill body.
     *
     * @param candidate - a candidate this provider produced.
     * @returns the full skill definition, or undefined when it disappeared.
     */
    async get(candidate) {
      const located = await locateSkill(candidate.locator.directory)
      if (located === undefined) return undefined
      return toDefinition(located)
    },
  }
}

/**
 * Project a located skill into a registry candidate.
 *
 * @param located - result of {@link locateSkill}.
 * @returns the candidate value.
 */
function toCandidate(located) {
  return {
    ...toSkillFields(located),
    rank: SKILL_RANK,
    locator: { path: located.path, directory: located.directory },
  }
}

/**
 * Project a located skill into a loaded definition.
 *
 * @param located - result of {@link locateSkill}.
 * @returns the definition value.
 */
function toDefinition(located) {
  return { ...toSkillFields(located), content: located.parsed.body }
}

/**
 * Build the fields shared by candidates and definitions.
 *
 * @param located - result of {@link locateSkill}.
 * @returns the shared summary fields.
 */
function toSkillFields(located) {
  const { fields } = located.parsed
  return {
    name: fields.name,
    description: fields.description,
    ...fields.whenToUse === undefined ? {} : { whenToUse: fields.whenToUse },
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'bundled',
    provider: PROVIDER_NAME,
    resourceBase: { kind: 'directory', path: located.directory },
    path: located.path,
  }
}
