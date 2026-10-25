import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const preferenceKey = '@mars.liu/dsh-graft:ui-language'

function harness({ active = 'en', preference, storageThrows = false } = {}) {
  let bundle
  const storage = new Map(preference ? [[preferenceKey, preference]] : [])
  const dictionaries = new Map()
  const localeListeners = new Set()
  const windowListeners = new Map()
  const disposers = []
  const registrations = []
  let snapshot = { active, revision: 0, locales: [{ id: 'en' }, { id: 'zh', fallback: 'en' }] }
  const notify = () => { snapshot = { ...snapshot, revision: snapshot.revision + 1 }; for (const listener of localeListeners) listener() }
  const locale = {
    getLocale: () => snapshot,
    getSnapshot: () => snapshot,
    subscribe: (listener) => { localeListeners.add(listener); return () => localeListeners.delete(listener) },
    setLocale: () => { throw new Error('Graft must not change the host language') },
    addLanguage: (input) => {
      snapshot = { ...snapshot, locales: [...snapshot.locales, input] }
      notify()
      return () => { snapshot = { ...snapshot, locales: snapshot.locales.filter((row) => row.id !== input.id) }; notify() }
    },
    register: (namespace, language, dictionary) => {
      const key = `${namespace}:${language}`
      assert.equal(dictionaries.has(key), false)
      dictionaries.set(key, dictionary)
      return () => dictionaries.delete(key)
    },
    bind: (namespace) => (key, params = {}) => {
      const dict = dictionaries.get(`${namespace}:${snapshot.active}`) ?? dictionaries.get(`${namespace}:en`)
      return String(dict?.[key] ?? key).replace(/\{(\w+)\}/g, (match, name) => String(params[name] ?? match))
    },
  }
  const componentStates = new Map()
  let states = []
  let hookIndex = 0
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    useEffect: () => {},
    useState: (initial) => {
      const index = hookIndex++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      const current = states
      return [states[index], (value) => { current[index] = value }]
    },
  }
  const window = {
    __ModuleLoader__: { load: (value) => { bundle = value } },
    localStorage: {
      getItem: (key) => { if (storageThrows) throw new Error('storage denied'); return storage.get(key) ?? null },
      setItem: (key, value) => { if (storageThrows) throw new Error('storage denied'); storage.set(key, value) },
    },
    addEventListener: (name, fn) => { windowListeners.set(name, fn) },
    removeEventListener: (name) => windowListeners.delete(name),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  }
  vm.runInNewContext(source, { window, console, setTimeout, clearTimeout })
  const client = bundle.factory((name) => { assert.equal(name, 'react'); return react })
  const sessionList = { ids: [], byId: {} }
  client.apply({
    locale,
    sessions: { list: { getSnapshot: () => sessionList, subscribe: () => () => {} }, binding: () => undefined },
    workspaces: { list: { getSnapshot: () => ({ items: [] }) } },
    effect: (fn) => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
    slots: {
      inject: (_name, factory) => factory(),
      register: (config, Component) => { registrations.push({ config, Component }); return () => {} },
    },
  })
  const get = (name) => registrations.find(({ config }) => config.name === name)
  const render = (name) => {
    const entry = get(name)
    if (!componentStates.has(name)) componentStates.set(name, [])
    states = componentStates.get(name)
    hookIndex = 0
    return entry.Component({
      sessionId: 'test-session',
      useGraft: (select) => select({ mode: true, count: 2, turns: [1, 2], notice: null }),
      useTurnIndex: (select) => select(new Map([['message-1', 1]])),
      messageId: 'message-1',
    })
  }
  return { client, locale, dictionaries, windowListeners, storage, render, changeHost: (active) => { snapshot = { ...snapshot, active }; notify() }, dispose: () => { for (const dispose of disposers.reverse()) dispose() } }
}

const flatten = (node) => {
  if (node == null || typeof node === 'boolean') return []
  if (Array.isArray(node)) return node.flatMap(flatten)
  if (typeof node !== 'object') return [String(node)]
  return [node, ...flatten(node.children)]
}
const visible = (tree) => flatten(tree).filter((value) => typeof value === 'string').join(' ')

test('auto follows English and Turkish host locale without writing host preferences', () => {
  const app = harness()
  assert.match(visible(app.render('conversation.input.dock')), /Send|Forward/)
  app.changeHost('tr')
  assert.match(visible(app.render('conversation.input.dock')), /aktar|Aktar/)
  app.changeHost('zh')
  assert.match(visible(app.render('conversation.input.dock')), /发送嫁接/)
  app.dispose()
})

test('explicit Turkish preference overrides host language and translates accessible labels', () => {
  const app = harness({ active: 'en', preference: 'tr' })
  const tree = app.render('conversation.input.dock')
  assert.match(visible(tree), /aktar|Aktar/)
  assert.doesNotMatch(visible(tree), /已选|选择目标|发送嫁接/)
  const labelled = flatten(tree).filter((node) => node?.props?.['aria-label'])
  assert.ok(labelled.length > 0)
  assert.ok(labelled.every((node) => !/[\u3400-\u9fff]/u.test(node.props['aria-label'])))
  app.changeHost('zh')
  assert.match(visible(app.render('conversation.input.dock')), /aktar|Aktar/)
  app.dispose()
})

test('blocked storage and unsupported preferences fall back safely', () => {
  for (const options of [{ storageThrows: true }, { preference: 'invalid' }]) {
    const app = harness(options)
    assert.match(visible(app.render('conversation.input.dock')), /Send|Forward/)
    app.dispose()
  }
})

test('language selection persists locally and cross-tab changes update the next render', () => {
  const app = harness()
  const tree = app.render('conversation.input.dock')
  const selector = flatten(tree).find((node) => node?.type === 'select' && node.props['aria-label'] === 'Graft UI language')
  selector.props.onChange({ target: { value: 'tr' } })
  assert.equal(app.storage.get(preferenceKey), 'tr')
  assert.match(visible(app.render('conversation.input.dock')), /2 tur seçildi/)
  app.storage.set(preferenceKey, 'en')
  app.windowListeners.get('storage')({ key: preferenceKey })
  assert.match(visible(app.render('conversation.input.dock')), /2 turns selected/)
  app.dispose()
})

test('send errors remain localized and react to language changes without string-based error styling', async () => {
  const app = harness({ preference: 'tr' })
  let tree = app.render('conversation.input.dock')
  const target = flatten(tree).find((node) => node?.type === 'select' && node.props['aria-label'] === 'Aktarımın hedef sohbeti')
  target.props.onChange({ target: { value: 'new' } })
  tree = app.render('conversation.input.dock')
  const send = flatten(tree).find((node) => node?.type === 'button' && visible(node) === 'Aktarımı gönder')
  assert.equal(send.props.disabled, false)
  await send.props.onClick()
  tree = app.render('conversation.input.dock')
  const status = flatten(tree).find((node) => node?.props?.role === 'status')
  assert.match(visible(status), /Gönderilemedi: Kaynak sohbet yüklenmedi/)
  assert.match(status.props.style.color, /state-error/)
  app.storage.set(preferenceKey, 'en')
  app.windowListeners.get('storage')({ key: preferenceKey })
  assert.match(visible(app.render('conversation.input.dock')), /Send failed: The source session is not loaded/)
  app.dispose()
})

test('locale dictionaries have balanced keys and interpolation placeholders', () => {
  const app = harness()
  const groups = [...app.dictionaries.values()]
  assert.equal(groups.length, 3)
  const keys = Object.keys(groups[0]).sort()
  for (const dictionary of groups) assert.deepEqual(Object.keys(dictionary).sort(), keys)
  for (const key of keys) {
    const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
    for (const dictionary of groups) assert.deepEqual(placeholders(dictionary[key]), placeholders(groups[0][key]), key)
  }
  app.dispose()
  assert.equal(app.dictionaries.size, 0)
  assert.equal(app.windowListeners.size, 0)
})
