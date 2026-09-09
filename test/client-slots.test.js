import assert from 'node:assert/strict'
import test from 'node:test'

// The browser half registers itself with the client module loader at import
// time; capture that registration, then materialize the factory with a stub
// react. The components under test are plain functions over props (hooks
// arrive as inject-face props), so no renderer is needed.
let bundle = null
globalThis.window = { __ModuleLoader__: { load: (candidate) => { bundle = candidate } } }
await import('../client.js')

const reactStub = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) }
const client = bundle.factory((name) => {
  if (name === 'react') return reactStub
  throw new Error(`unexpected require: ${name}`)
})

// Minimal HostObservable event-source store: fresh snapshot identity per
// publish, listener set the index is expected to detach from.
const createStore = (entries) => {
  let snapshot = { entries }
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    publish: (nextEntries) => {
      snapshot = { entries: nextEntries }
      for (const fn of [...listeners]) fn()
    },
    listenerCount: () => listeners.size,
  }
}

// Raw binding window: turn 1 produces a file (a write tool call between two
// assistant messages — the shape that used to lose the turnTail chain
// election to the host deliverables badge), turn 2 is pure prose.
const entries = () => [
  { type: 'event', event: { type: 'turn/start', seq: 1, data: { turn: 1 } } },
  { type: 'event', event: { type: 'user/message', seq: 2, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'question' }] } } },
  { type: 'chunks', chunks: [{ text: 'partial' }] },
  { type: 'event', event: { type: 'assistant/message', seq: 4, data: { turn: 1, step: 0, message: { id: 'm-mid-1', content: [] } } } },
  { type: 'event', event: { type: 'tool/call', seq: 5, data: { turn: 1, step: 1, callId: 'c1', name: 'write', arguments: '{}' } } },
  { type: 'event', event: { type: 'assistant/message', seq: 6, data: { turn: 1, step: 2, message: { id: 'm-closing-1', content: [{ type: 'text', text: 'answer 1' }] } } } },
  { type: 'event', event: { type: 'turn/end', seq: 7, data: { turn: 1 } } },
  { type: 'event', event: { type: 'turn/start', seq: 8, data: { turn: 2 } } },
  { type: 'event', event: { type: 'user/message', seq: 9, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'question 2' }] } } },
  { type: 'event', event: { type: 'assistant/message', seq: 10, data: { turn: 2, step: 0, message: { id: 'm-closing-2', content: [{ type: 'text', text: 'answer 2' }] } } } },
  { type: 'event', event: { type: 'turn/end', seq: 11, data: { turn: 2 } } },
]

const turn3 = () => [
  { type: 'event', event: { type: 'turn/start', seq: 12, data: { turn: 3 } } },
  { type: 'event', event: { type: 'user/message', seq: 13, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'question 3' }] } } },
  { type: 'event', event: { type: 'assistant/message', seq: 14, data: { turn: 3, step: 0, message: { id: 'm-closing-3', content: [{ type: 'text', text: 'answer 3' }] } } } },
  { type: 'event', event: { type: 'turn/end', seq: 15, data: { turn: 3 } } },
]

const sessionsWith = (eventSource) => ({
  binding: (sessionId) => (sessionId === 'session-1' ? { eventSource } : undefined),
})

const install = (sessions) => {
  const registrations = []
  client.apply({
    sessions,
    workspaces: { list: { getSnapshot: () => ({ items: [] }) } },
    effect: (fn) => fn(),
    slots: {
      inject: (name, factory) => factory(),
      register: (config, Component) => { registrations.push({ config, Component }); return () => {} },
    },
  })
  return registrations
}

const actionRegistration = (registrations) =>
  registrations.find(({ config }) => config.name === 'conversation.chat.assistant-actions')

test('registers the browser bundle under the plugin id', () => {
  assert.equal(bundle.id, '@mars.liu/dsh-graft')
  assert.deepEqual(client.inject, ['slots', 'sessions', 'workspaces'])
  assert.equal(typeof client.apply, 'function')
})

test('selects turns through the assistant-actions list slot, not the turnTail chain slot', () => {
  const registrations = install(sessionsWith(createStore(entries())))
  const names = registrations.map(({ config }) => config.name)

  // The turnTail chain slot must no longer be claimed: the host deliverables
  // badge registers first and wins every file-producing turn there.
  assert.equal(names.includes('conversation.chat.turnTail'), false)
  assert.deepEqual([...names].sort(), [
    'conversation.chat.assistant-actions',
    'conversation.input.dock',
    'conversation.session.header.actions',
  ])
  assert.deepEqual(
    Object.fromEntries(registrations.map(({ config }) => [config.name, [config.id, config.order]])),
    {
      'conversation.session.header.actions': ['graft', 50],
      'conversation.chat.assistant-actions': ['graft', 20],
      'conversation.input.dock': ['graft', 40],
    },
  )
  const action = actionRegistration(registrations)
  assert.equal(typeof action.config.inject, 'function')
  assert.equal(typeof action.Component, 'function')
})

test('inject face binds the controller and the message→turn index', () => {
  const face = actionRegistration(install(sessionsWith(createStore(entries()))))
    .config.inject('session-1')

  assert.equal(face.hooks.graft.sessionId, 'session-1')
  assert.equal(typeof face.hooks.graft.toggleMode, 'function')
  assert.equal(typeof face.hooks.graft.toggleTurn, 'function')

  assert.equal(typeof face.hooks.turnIndex.getSnapshot, 'function')
  assert.equal(typeof face.hooks.turnIndex.subscribe, 'function')
  const turns = face.hooks.turnIndex.getSnapshot()
  assert.equal(turns.get('m-closing-1'), 1) // the file-producing turn
  assert.equal(turns.get('m-mid-1'), 1)     // mid-turn assistant message maps to its turn too
  assert.equal(turns.get('m-closing-2'), 2)
  assert.equal(turns.get('missing'), undefined)
})

test('turn index snapshot is cached per entries identity and follows publishes', () => {
  const store = createStore(entries())
  const face = actionRegistration(install(sessionsWith(store)))
    .config.inject('session-1')

  const first = face.hooks.turnIndex.getSnapshot()
  assert.equal(face.hooks.turnIndex.getSnapshot(), first)

  store.publish([...entries(), ...turn3()])
  const second = face.hooks.turnIndex.getSnapshot()
  assert.notEqual(second, first)
  assert.equal(second.get('m-closing-1'), 1)
  assert.equal(second.get('m-closing-3'), 3)
})

test('turn index relays eventSource notifications and detaches with its last listener', () => {
  const store = createStore(entries())
  const face = actionRegistration(install(sessionsWith(store)))
    .config.inject('session-1')

  let calls = 0
  const offOne = face.hooks.turnIndex.subscribe(() => { calls += 1 })
  assert.equal(store.listenerCount(), 1)
  const offTwo = face.hooks.turnIndex.subscribe(() => {})
  assert.equal(store.listenerCount(), 1) // one shared relay subscription

  store.publish(entries())
  assert.equal(calls, 1)

  offTwo()
  assert.equal(store.listenerCount(), 1)
  offOne()
  assert.equal(store.listenerCount(), 0)

  const offThree = face.hooks.turnIndex.subscribe(() => {}) // re-attaches after full detach
  assert.equal(store.listenerCount(), 1)
  offThree()
  assert.equal(store.listenerCount(), 0)
})

test('picker renders per closing message and toggles the turn through the controller', () => {
  const registration = actionRegistration(install(sessionsWith(createStore(entries()))))
  const face = registration.config.inject('session-1')
  const controller = face.hooks.graft
  const useGraft = (select) => select(controller.getSnapshot())
  const useTurnIndex = (select) => select(face.hooks.turnIndex.getSnapshot())
  const pick = (messageId) =>
    registration.Component({ sessionId: 'session-1', messageId, useGraft, useTurnIndex })

  assert.equal(pick('m-closing-1'), null) // graft mode off

  controller.toggleMode()
  let button = pick('m-closing-1') // the file-producing turn
  assert.equal(button.type, 'button')
  assert.equal(button.props.type, 'button')
  assert.equal(button.props['aria-pressed'], false)
  assert.equal(button.props.title, '选择轮次 1 用于嫁接')
  assert.equal(button.props['aria-label'], '选择轮次 1 用于嫁接')
  assert.deepEqual(button.children, ['+ #1'])
  assert.equal(pick('missing'), null) // unresolvable message id stays hidden

  button.props.onClick()
  assert.deepEqual(controller.getSnapshot().turns, [1])
  button = pick('m-closing-1')
  assert.equal(button.props['aria-pressed'], true)
  assert.deepEqual(button.children, ['✓ #1'])

  button.props.onClick()
  assert.deepEqual(controller.getSnapshot().turns, [])

  assert.deepEqual(pick('m-closing-2').children, ['+ #2']) // the no-file turn picks its own number
})

test('degrades to an empty index when the session binding is not loaded', () => {
  const face = actionRegistration(install(sessionsWith(createStore(entries()))))
    .config.inject('session-unloaded')

  assert.equal(face.hooks.graft.sessionId, 'session-unloaded') // controller stays live
  const turns = face.hooks.turnIndex.getSnapshot()
  assert.equal(turns.size, 0)
  assert.equal(turns.get('m-closing-1'), undefined)
  const off = face.hooks.turnIndex.subscribe(() => {})
  assert.equal(typeof off, 'function')
  off()
})
