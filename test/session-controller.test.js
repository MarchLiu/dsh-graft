import assert from 'node:assert/strict'
import test from 'node:test'
import { apply, inject } from '../index.js'

const SOURCE_ID = 'session-source'
const TARGET_ID = 'session-target'

const events = [
  {
    type: 'user/message',
    seq: 0,
    time: 1,
    data: { role: 'user', content: [{ type: 'text', text: 'source question' }] },
  },
  {
    type: 'assistant/message',
    seq: 1,
    time: 2,
    data: { message: { content: [{ type: 'text', text: 'source answer' }] } },
  },
]

function install() {
  const tools = new Map()
  const calls = []
  const controller = {
    async list(request, signal) {
      calls.push({ method: 'list', request, signal })
      return {
        items: [
          {
            sessionId: SOURCE_ID,
            title: 'Source',
            cwd: '/source',
            updatedAt: 1,
            running: false,
            blank: false,
          },
          {
            sessionId: TARGET_ID,
            title: 'Target',
            cwd: '/target',
            updatedAt: 2,
            running: false,
            blank: false,
          },
        ],
      }
    },
    async search(request, signal) {
      calls.push({ method: 'search', request, signal })
      return { items: [{ sessionId: SOURCE_ID, snippet: 'source answer' }], hasMore: false }
    },
    async inspect(sessionId, signal) {
      calls.push({ method: 'inspect', sessionId, signal })
      assert.equal(sessionId, SOURCE_ID)
      return { events }
    },
    async create(request) {
      calls.push({ method: 'create', request })
      return { sessionId: 'session-created' }
    },
    async rename(request) {
      calls.push({ method: 'rename', request })
      return { title: request.title, seq: 2 }
    },
    async fork(request) {
      calls.push({ method: 'fork', request })
      return { sessionId: 'session-forked' }
    },
    async prompt(request, signal) {
      calls.push({ method: 'prompt', request, signal })
      return { accepted: true }
    },
  }
  apply({
    sessionController: controller,
    tools: { register(tool) { tools.set(tool.name, tool) } },
    logger: { info() {} },
  })
  return { calls, tools }
}

test('declares the session controller dependency', () => {
  assert.deepEqual(inject, ['tools', 'sessionController'])
})

test('routes session operations through sessionController', async () => {
  const { calls, tools } = install()

  assert.match(await tools.get('graft_sessions').execute({}), /session-source/)
  assert.match(await tools.get('graft_search').execute({ query: 'source' }), /source answer/)
  assert.match(await tools.get('graft_read').execute({ session: 'source' }), /source answer/)
  assert.match(await tools.get('graft_fork').execute({ session: 'source', atSeq: 1 }), /session-forked/)
  assert.match(await tools.get('graft_forward').execute({
    session: 'source',
    newSession: { cwd: '/created', title: 'Created target' },
  }), /session-created/)

  assert.deepEqual(calls.find(call => call.method === 'search').request, { query: 'source' })
  assert.equal(calls.filter(call => call.method === 'inspect').length, 2)
  assert.deepEqual(calls.find(call => call.method === 'fork').request, { sessionId: SOURCE_ID, atSeq: 1 })
  assert.deepEqual(calls.find(call => call.method === 'create').request, { cwd: '/created' })
  assert.deepEqual(calls.find(call => call.method === 'rename').request, {
    sessionId: 'session-created',
    title: 'Created target',
  })

  const prompt = calls.find(call => call.method === 'prompt')
  assert.equal(prompt.request.sessionId, 'session-created')
  assert.equal(prompt.request.mode, 'queue')
  assert.equal(typeof prompt.request.requestId, 'string')
  assert.match(prompt.request.content[0].text, /source answer/)
  for (const call of calls.filter(call => ['list', 'search', 'inspect', 'prompt'].includes(call.method))) {
    assert.equal(call.signal instanceof AbortSignal, true, `${call.method} receives an AbortSignal`)
  }
})
