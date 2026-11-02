import { describe, expect, it, vi } from 'vitest'
import {
  emptyKnowledgeSearchIndex,
  indexableKnowledgePages,
  knowledgePagePassages,
  meaningSearchNote,
  parseKnowledgeSearchIndex,
  planKnowledgeSearchUpdate,
  rankKnowledgeWithMeaning,
  serializeKnowledgeSearchIndex,
  updateKnowledgeSearchIndex,
} from './knowledgeMeaning'
import { blendKnowledgeSearch, knowledgeMeaningScores, knowledgeQueryTerms, publishKnowledgePage } from './organisationKnowledge.mjs'
import type { KnowledgePage, KnowledgeStore } from './knowledgeTypes'

const DIMS = 8
const page = (over: Partial<KnowledgePage> & { id: string; title: string }): KnowledgePage => ({
  spaceId: 's',
  slug: over.title.toLowerCase().replace(/\W+/g, '-'),
  kind: 'wiki',
  body: '',
  tags: [],
  links: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
} as KnowledgePage)
const storeOf = (pages: KnowledgePage[]): KnowledgeStore => ({ schemaVersion: 1, spaces: [], pages, activity: [], agentChanges: [], activeSpaceId: 's', activePageId: null } as unknown as KnowledgeStore)

/** A fake model: each topic word lights one dimension, so "meaning" is testable without the real one. */
const TOPICS = ['money', 'travel', 'food', 'music', 'health', 'law', 'sport', 'garden']
const SYNONYMS: Record<string, string> = { funding: 'money', backers: 'money', investors: 'money', trips: 'travel', flights: 'travel', recipe: 'food', dinner: 'food', statute: 'law' }
function fakeVector(text: string): number[] {
  const vector = new Array(DIMS).fill(0.01)
  for (const word of text.toLowerCase().split(/\W+/)) {
    const at = TOPICS.indexOf(SYNONYMS[word] ?? word)
    if (at >= 0) vector[at] += 1
  }
  const size = Math.hypot(...vector)
  return vector.map(value => value / size)
}
const fakeEmbed = () => vi.fn(async (texts: string[]) => texts.map(fakeVector))

describe('passages', () => {
  it('starts with the page identity, keeps offsets and skips images and data', () => {
    const body = '# Plan\n\nFirst paragraph here.\n\n![pic](data:image/png;base64,AAAA)\n\n## Costs\n\nSecond [[Other page|linked]] paragraph.\n'
    const passages = knowledgePagePassages(page({ id: 'p', title: 'Budget', aliases: ['Spend'], tags: ['money'], body }))
    expect(passages[0].text).toContain('Budget (Spend) — money')
    expect(passages.some(p => p.text.includes('base64'))).toBe(false)
    const costs = passages.slice(1).find(p => p.text.includes('Second Other page'))!
    expect(costs.text.startsWith('Budget — Costs\n')).toBe(true)
    expect(body.slice(costs.at, costs.end)).toContain('Second')
  })

  it('leaves the other passages alone when one part of a page changes', () => {
    const body = (one: string) => `# A\n\n${one}\n\n# B\n\nSection two stays.\n\n# C\n\nSection three stays.`
    const before = knowledgePagePassages(page({ id: 'p', title: 'T', body: body('One.') })).map(p => p.hash)
    const after = knowledgePagePassages(page({ id: 'p', title: 'T', body: body('One, now longer.') })).map(p => p.hash)
    expect(before.filter(hash => after.includes(hash)).length).toBeGreaterThanOrEqual(2)
  })

  it('splits a very long paragraph', () => {
    const long = Array.from({ length: 500 }, (_, i) => `w${i}`).join(' ')
    const passages = knowledgePagePassages(page({ id: 'p', title: 'T', body: long }))
    expect(passages.length).toBeGreaterThanOrEqual(4)
    expect(Math.max(...passages.map(p => p.text.split(/\s+/).length))).toBeLessThanOrEqual(180)
  })
})

describe('keeping the index current', () => {
  const pages = () => [
    page({ id: 'a', title: 'Fundraising', body: 'Talking to investors about funding.\n\n# Next\n\nA second section.' }),
    page({ id: 'b', title: 'Holidays', body: 'Booking flights and trips.' }),
  ]
  const build = async (list: KnowledgePage[]) => {
    const embed = fakeEmbed()
    const result = await updateKnowledgeSearchIndex(emptyKnowledgeSearchIndex('m', DIMS), list, embed, { batchSize: 2 })
    return { ...result, embed }
  }

  it('reads every passage once on a first build', async () => {
    const list = pages()
    const { index, embedded, embed } = await build(list)
    expect(Object.keys(index.pages).sort()).toEqual(['a', 'b'])
    expect(embedded).toBe(list.flatMap(knowledgePagePassages).length)
    expect(embed.mock.calls.every(([texts]) => texts.length <= 2)).toBe(true)
  })

  it('does nothing when nothing changed', async () => {
    const list = pages()
    const { index } = await build(list)
    const embed = fakeEmbed()
    const second = await updateKnowledgeSearchIndex(index, list, embed)
    expect(embed).not.toHaveBeenCalled()
    expect(second.embedded).toBe(0)
    expect(planKnowledgeSearchUpdate(index, list).work).toEqual([])
  })

  it('reads only the changed passages of an edited page and leaves other pages alone', async () => {
    const list = pages()
    const { index } = await build(list)
    const edited = [{ ...list[0], body: list[0].body.replace('A second section.', 'A rewritten section.') }, list[1]]
    const embed = fakeEmbed()
    const result = await updateKnowledgeSearchIndex(index, edited, embed)
    // The rewritten section, and the page's opening passage that quotes it.
    expect(result.embedded).toBe(2)
    expect(result.reused).toBeGreaterThan(0)
    expect(embed.mock.calls[0][0].every(text => text.includes('rewritten'))).toBe(true)
    expect(result.index.pages.b).toBe(index.pages.b)
  })

  it('removes deleted pages', async () => {
    const list = pages()
    const { index } = await build(list)
    const result = await updateKnowledgeSearchIndex(index, [list[0]], fakeEmbed())
    expect(result.removed).toBe(1)
    expect(result.index.pages.b).toBeUndefined()
  })

  it('keeps finished pages when the model stops halfway, and carries on from there', async () => {
    const list = pages()
    const failing = vi.fn(async (texts: string[]) => {
      if (texts.some(text => text.includes('Holidays'))) throw new Error('stopped')
      return texts.map(fakeVector)
    })
    let kept = emptyKnowledgeSearchIndex('m', DIMS)
    await expect(updateKnowledgeSearchIndex(kept, list, failing, { onProgress: index => { kept = index } })).rejects.toThrow('stopped')
    expect(Object.keys(kept.pages)).toEqual(['a'])
    const embed = fakeEmbed()
    const resumed = await updateKnowledgeSearchIndex(kept, list, embed)
    expect(embed.mock.calls.flatMap(([texts]) => texts).every(text => text.includes('Holidays'))).toBe(true)
    expect(Object.keys(resumed.index.pages).sort()).toEqual(['a', 'b'])
  })

  it('refuses vectors that do not fit, rather than save nonsense', async () => {
    await expect(updateKnowledgeSearchIndex(emptyKnowledgeSearchIndex('m', DIMS), pages(), async texts => texts.map(() => [1, 2]))).rejects.toThrow('wrong length')
    await expect(updateKnowledgeSearchIndex(emptyKnowledgeSearchIndex('m', DIMS), pages(), async () => [])).rejects.toThrow('wrong number')
  })

  it('survives a save and reload, and starts again for another model', async () => {
    const list = pages()
    const { index } = await build(list)
    const raw = serializeKnowledgeSearchIndex(index)
    const reloaded = parseKnowledgeSearchIndex(raw, 'm', DIMS)
    expect(reloaded).toEqual(index)
    expect(planKnowledgeSearchUpdate(reloaded, list).work).toEqual([])
    expect(parseKnowledgeSearchIndex(raw, 'other', DIMS).pages).toEqual({})
    expect(parseKnowledgeSearchIndex(raw, 'm', 4).pages).toEqual({})
    expect(parseKnowledgeSearchIndex('not json', 'm', DIMS).pages).toEqual({})
    expect(parseKnowledgeSearchIndex(null, 'm', DIMS).pages).toEqual({})
  })

  it('drops only the damaged page from a damaged file', async () => {
    const { index } = await build(pages())
    const damaged = { ...index, pages: { ...index.pages, b: { ...index.pages.b, vectors: 'AA==' } } }
    const reloaded = parseKnowledgeSearchIndex(JSON.stringify(damaged), 'm', DIMS)
    expect(Object.keys(reloaded.pages)).toEqual(['a'])
  })
})

describe('policies', () => {
  const published = publishKnowledgePage(
    page({ id: 'pol', title: 'Travel policy', tags: ['policy'], body: 'Published flights rule.', governance: { category: 'policy', owner: 'O', sources: ['S'], reviewDue: '2099-01-01' } as KnowledgePage['governance'] }),
    'Person',
    '2026-01-01T00:00:00.000Z',
  )
  const edited = { ...published, body: 'Working draft about a recipe.' }

  it('indexes the published text apart from a working draft', () => {
    expect(indexableKnowledgePages([published]).map(item => item.key)).toEqual(['pol'])
    const both = indexableKnowledgePages([edited])
    expect(both.map(item => item.key)).toEqual(['pol', 'pol#draft'])
    expect(both[0].page.body).toContain('Published')
    expect(both[1].page.body).toContain('Working')
  })

  it('never finds a page by its draft unless drafts were asked for', async () => {
    const { index } = await updateKnowledgeSearchIndex(emptyKnowledgeSearchIndex('m', DIMS), [edited], fakeEmbed())
    const question = fakeVector('dinner')
    const live = knowledgeMeaningScores(index, question, [edited]).get('pol')!.score
    const drafted = knowledgeMeaningScores(index, question, [edited], { drafts: true }).get('pol')!.score
    expect(drafted).toBeGreaterThan(live)
  })
})

describe('ranking', () => {
  const pages = [
    page({ id: 'money', title: 'Raising a round', body: 'We talk to investors and funding sources. Quarterly numbers are here.' }),
    page({ id: 'trips', title: 'Getting around', body: 'Flights and trips for the team. Zenvolta is the vendor we book through.' }),
    page({ id: 'food', title: 'Team lunches', body: 'A recipe for every dinner.' }),
    page({ id: 'laws', title: 'Statute notes', aliases: ['Legal'], tags: ['law'], body: 'The statute that applies.' }),
    page({ id: 'music', title: 'Money for music', body: 'Studio time and music.' }),
  ]
  const indexOf = async (list: KnowledgePage[]) => (await updateKnowledgeSearchIndex(emptyKnowledgeSearchIndex('m', DIMS), list, fakeEmbed())).index
  const rank = async (query: string, list = pages) => rankKnowledgeWithMeaning(storeOf(list), query, 100, undefined, await indexOf(list), fakeVector(query))

  it('finds a page by meaning when none of the words match', async () => {
    const hits = await rank('backers')
    expect(hits[0].page.id).toBe('money')
    expect(hits[0].matched).toBe('meaning')
    expect(hits[0].snippet.length).toBeGreaterThan(0)
  })

  it('puts an exact title or alias first even when meaning prefers another page', async () => {
    expect((await rank('Money for music'))[0].page.id).toBe('music')
    expect((await rank('legal'))[0].page.id).toBe('laws')
  })

  it('lets a rare exact word find its page', async () => {
    const hits = await rank('Zenvolta')
    expect(hits[0].page.id).toBe('trips')
    expect(hits[0].matched).not.toBe('meaning')
  })

  it('never drops a page holding every word of the query', async () => {
    const list = Array.from({ length: 30 }, (_, i) => page({ id: `p${i}`, title: `Page ${i}`, body: i % 2 ? 'alpha bravo words' : 'alpha only' }))
    const hits = await rank('alpha bravo', list)
    expect(hits.map(hit => hit.page.id)).toEqual(expect.arrayContaining(list.filter((_, i) => i % 2).map(p => p.id)))
    const none = blendKnowledgeSearch(list, 'alpha bravo', new Map())
    expect(none.map(hit => hit.page.id).sort()).toEqual(list.filter((_, i) => i % 2).map(p => p.id).sort())
  })

  it('returns nothing for a query far from everything, rather than the nearest noise', () => {
    const scores = new Map(pages.map(p => [p.id, { score: 0.4, at: 0, end: 1 }]))
    expect(blendKnowledgeSearch(pages, 'zebra crossing', scores)).toEqual([])
  })

  it('stops at the closest dozen when many pages are about equally near', () => {
    const list = Array.from({ length: 40 }, (_, i) => page({ id: `n${i}`, title: `Note ${i}`, body: 'text' }))
    const scores = new Map(list.map((p, i) => [p.id, { score: 0.7 - i / 1000, at: 0, end: 1 }]))
    expect(blendKnowledgeSearch(list, 'something unrelated', scores).map(hit => hit.page.id)).toEqual(list.slice(0, 12).map(p => p.id))
  })

  it('keeps Current guidance ahead of other matches, but never ahead of an exact name', async () => {
    const list = [
      page({ id: 'cur', title: 'Travel guidance', guidanceStatus: 'current', body: 'flights and trips' } as Partial<KnowledgePage> & { id: string; title: string }),
      page({ id: 'name', title: 'Trips', body: 'flights and trips' }),
      page({ id: 'other', title: 'Other trips', body: 'flights and trips' }),
    ]
    expect((await rank('flights', list))[0].page.id).toBe('cur')
    expect((await rank('Trips', list))[0].page.id).toBe('name')
  })

  it('respects the status filter', async () => {
    const list = [page({ id: 'cur', title: 'A', guidanceStatus: 'current', body: 'flights' } as Partial<KnowledgePage> & { id: string; title: string }), page({ id: 'x', title: 'B', body: 'flights' })]
    const hits = rankKnowledgeWithMeaning(storeOf(list), 'flights', 10, 'current', await indexOf(list), fakeVector('flights'))
    expect(hits.map(hit => hit.page.id)).toEqual(['cur'])
  })

  it('keeps names and dotted terms whole, and ignores words that say nothing', () => {
    expect(knowledgeQueryTerms('How does Paged.js use moz-extension?')).toEqual(['paged.js', 'use', 'moz-extension'])
    expect(knowledgeQueryTerms('how do I')).toEqual([])
  })
})

describe('saying what was searched', () => {
  it('is silent only when meaning is fully ready', () => {
    expect(meaningSearchNote({ state: 'ready' })).toBeNull()
    for (const state of ['absent', 'downloading', 'failed', 'unsupported', 'checking', 'indexing'] as const) expect(meaningSearchNote({ state })).toMatch(/words/)
  })
})
