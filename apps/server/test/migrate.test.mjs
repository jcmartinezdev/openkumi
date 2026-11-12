// Bots used to be database rows with a browser profile at the top of their folder. Starting the
// server on such a data folder must turn each one into a bot folder without losing anything.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'

const PORT = 4900 + Math.floor(Math.random() * 90)

async function withServer(home, fn) {
  const server = spawn(process.execPath, ['src/index.ts'], {
    env: { ...process.env, OPENBOT_HOME: home, OPENBOT_PORT: String(PORT), OPENBOT_MOCK: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => String(d).includes('running at') && resolve())
    server.on('exit', (code) => reject(new Error(`server exited with ${code}`)))
  })
  try {
    const token = JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')).accessToken
    return await fn(async (url) => (await fetch(`http://127.0.0.1:${PORT}${url}`, { headers: { Authorization: `Bearer ${token}` } })).json())
  } finally {
    server.kill('SIGTERM')
    await new Promise((r) => server.on('exit', r))
  }
}

test('bots stored in the database become folders, keeping their id, logins and chats', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openbot-migrate-'))
  try {
    const db = new DatabaseSync(path.join(home, 'openbot.db'))
    db.exec(`
      CREATE TABLE bots (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, emoji TEXT NOT NULL, instructions TEXT NOT NULL,
        provider TEXT NOT NULL, model TEXT NOT NULL, effort TEXT NOT NULL, web_search INTEGER NOT NULL,
        headless INTEGER NOT NULL, memory TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE threads (
        id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, parent_id TEXT, title TEXT NOT NULL, kind TEXT NOT NULL,
        status TEXT NOT NULL, model TEXT, reported INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      INSERT INTO bots VALUES ('b_Old-1_x', 'Helper: v2', '🦊', 'Be brief.', 'mock', 'mock-1', 'low', 0, 0, '- Likes tea', 1700000000000);
      INSERT INTO bots VALUES ('b_Old-2', 'On the old sign-in', '🤖', '', 'chatgpt', 'gpt-5.5', '', 1, 1, '', 1700000000005);
      INSERT INTO threads VALUES ('t_1', 'b_Old-1_x', NULL, 'An old chat', 'chat', 'idle', NULL, 0, 1700000000001, 1700000000002);
    `)
    db.close()
    // What the removed ChatGPT sign-in left behind: a saved login, and settings that name it.
    fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ accessToken: 'keep-me', chatgpt: { refresh: 'old' } }))
    fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ defaultProvider: 'chatgpt', disabledProviders: ['chatgpt', 'mock'] }))
    const oldProfile = path.join(home, 'bots', 'b_Old-1_x', 'browser-profile')
    fs.mkdirSync(oldProfile, { recursive: true })
    fs.writeFileSync(path.join(oldProfile, 'Cookies'), 'logins')

    const dir = path.join(home, 'bots', 'b_Old-1_x')
    const looks = []
    for (const run of [1, 2]) {
      // The second start must find nothing left to do.
      const state = await withServer(home, (get) => get('/api/state'))
      assert.equal(state.bots.length, 2, `start ${run}: no default bot is added beside the imported ones`)
      // A bot that ran on Open Bot's own ChatGPT sign-in, which no longer exists, runs on Codex and keeps its model.
      assert.deepEqual([state.bots[1].id, state.bots[1].provider, state.bots[1].model], ['b_Old-2', 'codex', 'gpt-5.5'])
      assert.ok(!state.providers.some((p) => p.id === 'chatgpt'))
      assert.deepEqual([state.settings.defaultProvider, state.settings.disabledProviders], ['', ['mock']])
      const { superpowers: _, look, ...bot } = state.bots[0]
      // It had no look, so it is given one made from its id: the same on every start.
      looks.push(JSON.stringify(look))
      assert.deepEqual(Object.keys(look), ['creature', 'color', 'hat', 'extra', 'clothes'])
      assert.deepEqual(bot, {
        id: 'b_Old-1_x', name: 'Helper: v2', emoji: '🦊', description: '', rules: '', provider: 'mock', model: 'mock-1', effort: 'low',
        webSearch: false, headless: false, createdAt: 1700000000000,
      })
      assert.deepEqual(state.threads.map((t) => [t.id, t.botId, t.title]), [['t_1', 'b_Old-1_x', 'An old chat']])
    }

    assert.equal(looks[0], looks[1])
    assert.equal(fs.readFileSync(path.join(dir, 'private', 'browser-profile', 'Cookies'), 'utf8'), 'logins', 'logins moved with the profile')
    assert.ok(!fs.existsSync(oldProfile))
    assert.match(fs.readFileSync(path.join(dir, 'workspace', 'AGENTS.md'), 'utf8'), /^# Helper: v2\n\nBe brief\.\n/)
    assert.match(fs.readFileSync(path.join(dir, 'workspace', 'memory', 'notes.md'), 'utf8'), /- Likes tea/)

    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')), { accessToken: 'keep-me' }, 'the old sign-in is forgotten, the access code is not')

    const after = new DatabaseSync(path.join(home, 'openbot.db'))
    const tables = after.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((r) => r.name)
    assert.ok(tables.includes('bots_imported') && !tables.includes('bots'), 'the old rows are kept aside, not deleted')
    after.close()
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('a bot that had several chats keeps the one used last as its conversation, and the others as earlier ones', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openbot-migrate-'))
  try {
    const db = new DatabaseSync(path.join(home, 'openbot.db'))
    db.exec(`
      CREATE TABLE bots (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, emoji TEXT NOT NULL, instructions TEXT NOT NULL,
        provider TEXT NOT NULL, model TEXT NOT NULL, effort TEXT NOT NULL, web_search INTEGER NOT NULL,
        headless INTEGER NOT NULL, memory TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE threads (
        id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, parent_id TEXT, title TEXT NOT NULL, kind TEXT NOT NULL,
        status TEXT NOT NULL, model TEXT, reported INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL);
      INSERT INTO bots VALUES ('b_1', 'Helper', '🦊', '', 'mock', 'mock-1', '', 0, 1, '', 1700000000000);
      INSERT INTO bots VALUES ('b_2', 'Quiet', '🤖', '', 'mock', 'mock-1', '', 0, 1, '', 1700000000000);
      INSERT INTO threads VALUES ('t_old', 'b_1', NULL, 'The oldest', 'chat', 'idle', NULL, 0, 1700000000001, 1700000000010);
      INSERT INTO threads VALUES ('t_last', 'b_1', NULL, 'Used last', 'chat', 'idle', NULL, 0, 1700000000002, 1700000000090);
      INSERT INTO threads VALUES ('t_mid', 'b_1', NULL, 'In between', 'chat', 'idle', NULL, 0, 1700000000003, 1700000000050);
      INSERT INTO threads VALUES ('t_sub', 'b_1', 't_old', 'A subagent', 'subagent', 'idle', NULL, 1, 1700000000004, 1700000000005);
      INSERT INTO threads VALUES ('t_only', 'b_2', NULL, 'Its only chat', 'chat', 'idle', NULL, 0, 1700000000006, 1700000000007);
      INSERT INTO items (thread_id, data, created_at) VALUES ('t_old', '{"type":"message","role":"user","text":"an old question about herons","source":"user"}', 1700000000001);
    `)
    db.close()

    for (const run of [1, 2]) {
      await withServer(home, async (get) => {
        const { threads } = await get('/api/state')
        assert.deepEqual(
          threads.map((t) => [t.id, t.archivedAt]),
          [['t_old', 1700000000010], ['t_last', null], ['t_mid', 1700000000050], ['t_sub', null], ['t_only', null]],
          `start ${run}`,
        )
        // Nothing was deleted: what was said in an archived chat is still read and found.
        assert.equal((await get('/api/threads/t_old')).items[0].data.text, 'an old question about herons')
        assert.deepEqual((await get('/api/bots/b_1/search?q=herons')).matches.map((m) => m.threadId), ['t_old'])
      })
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('skills, connections and plugins become superpowers: what a bot had that is now one stays on, and the rest goes', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openbot-migrate-'))
  try {
    const bot = (id, settings) => {
      const dir = path.join(home, 'bots', id)
      fs.mkdirSync(path.join(dir, 'private', 'mcp'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'bot.md'), `---\nname: ${id}\nprovider: mock\n---\n`)
      for (const [file, value] of Object.entries(settings)) fs.writeFileSync(path.join(dir, file), JSON.stringify(value))
      return dir
    }
    // The catalog of skills Open Bot used to keep, with copies of its own and one the owner added.
    for (const name of ['deep-research', 'linear', 'gmail', 'mine']) {
      fs.mkdirSync(path.join(home, 'skills', name), { recursive: true })
      fs.writeFileSync(path.join(home, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`)
      if (name !== 'mine') fs.writeFileSync(path.join(home, 'skills', name, '.bundled'), '')
    }
    fs.writeFileSync(path.join(home, 'mcp.json'), JSON.stringify({ mcpServers: { notion: { url: 'https://mcp.notion.com/mcp' } } }))
    fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ accessToken: 'keep-me', plugins: { google: { clientId: 'x', clientSecret: 'y' } } }))
    const one = bot('one', { 'plugins.json': { installed: ['gmail', 'notion'] }, 'mcp.json': { enabled: ['gmail', 'notion'] } })
    fs.mkdirSync(path.join(one, 'skills'))
    for (const name of ['deep-research', 'linear']) fs.symlinkSync(path.join('..', '..', '..', 'skills', name), path.join(one, 'skills', name))
    fs.writeFileSync(path.join(one, 'private', 'mcp', 'notion.json'), '{}')
    const two = bot('two', {})

    for (const run of [1, 2]) {
      const state = await withServer(home, (get) => get('/api/state'))
      assert.deepEqual(state.bots.map((b) => [b.id, b.superpowers]), [['one', ['linear', 'notion']], ['two', []]], `start ${run}`)
    }
    for (const gone of ['skills', 'mcp.json', 'plugins.json', 'private/mcp']) assert.ok(!fs.existsSync(path.join(one, gone)), gone)
    assert.ok(!fs.existsSync(path.join(two, 'superpowers.json')), 'a bot that had nothing gets nothing')
    assert.deepEqual(fs.readdirSync(path.join(home, 'skills')), ['mine'], 'a skill the owner added is not deleted')
    assert.ok(!fs.existsSync(path.join(home, 'mcp.json')))
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')), { accessToken: 'keep-me' })
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})
