// What is started for a program on Windows, where one installed with npm is a launcher script
// that has to be read for the program behind it. The scripts are as npm and pnpm write them.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

// The server's modules keep their data in OPENKUMI_HOME, so it is set before they are loaded.
process.env.OPENKUMI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-programs-'))
const { launcher } = await import('../src/providers/cli.ts')
after(() => fs.rmSync(process.env.OPENKUMI_HOME, { recursive: true, force: true }))

const NPM = 'C:\\Users\\Ada\\AppData\\Roaming\\npm'
const head = ['@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0', '']
/** npm's launcher for a program that is a script for Node. */
const forNode = (script) =>
  [
    ...head,
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ') ELSE (',
    '  SET "_prog=node"',
    '  SET PATHEXT=%PATHEXT:;.JS;=;%',
    ')',
    '',
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${script}" %*`,
    '',
  ].join('\r\n')
/** npm's launcher for a program that is one already. */
const forProgram = (program) => [...head, `"%dp0%\\${program}"   %*`, ''].join('\r\n')

/** Follows a launcher on a computer that has these files, and these programs on its PATH. */
const follow = (bin, text, files = [], onPath = {}) =>
  launcher(
    bin,
    () => text,
    (file) => (files.includes(file) ? file : null),
    (name) => onPath[name] ?? null,
  )

test('a program that is not a launcher script is started as it is', () => {
  assert.deepEqual(launcher('/opt/homebrew/bin/claude'), ['/opt/homebrew/bin/claude'])
  assert.deepEqual(launcher('C:\\Users\\Ada\\.local\\bin\\claude.exe'), ['C:\\Users\\Ada\\.local\\bin\\claude.exe'])
})

test('npm’s launcher for a program leads to the program', () => {
  const program = `${NPM}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`
  assert.deepEqual(follow(`${NPM}\\claude.cmd`, forProgram('node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'), [program]), [program])
})

test('npm’s launcher for a script leads to Node and the script: the Node beside it, or else the one on the PATH', () => {
  const text = forNode('node_modules\\@openai\\codex\\bin\\codex.js')
  const script = `${NPM}\\node_modules\\@openai\\codex\\bin\\codex.js`
  const node = 'C:\\Program Files\\nodejs\\node.exe'
  assert.deepEqual(follow(`${NPM}\\codex.cmd`, text, [], { node }), [node, script])
  assert.deepEqual(follow(`${NPM}\\codex.cmd`, text, [`${NPM}\\node.exe`], { node }), [`${NPM}\\node.exe`, script])
})

test('pnpm’s launcher, which names Node on the line itself, leads to the same', () => {
  const home = 'C:\\Users\\Ada\\AppData\\Local\\pnpm'
  const text = [
    '@SETLOCAL',
    '@IF EXIST "%~dp0\\node.exe" (',
    '  "%~dp0\\node.exe"  "%~dp0\\global\\5\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
    ') ELSE (',
    '  @SET PATHEXT=%PATHEXT:;.JS;=;%',
    '  node  "%~dp0\\global\\5\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
    ')',
    '',
  ].join('\r\n')
  const node = 'C:\\Program Files\\nodejs\\node.exe'
  assert.deepEqual(follow(`${home}\\codex.CMD`, text, [], { node }), [node, `${home}\\global\\5\\node_modules\\@openai\\codex\\bin\\codex.js`])
})

test('a launcher that cannot be followed is not started through the command prompt: it is said what to do', () => {
  const told = /codex\.cmd is a launcher script OpenKumi cannot follow\. Give the path of the program it starts in Settings, under Providers\./
  // The program behind it is not there, Node is not installed, it starts another script, or it is not a launcher at all.
  assert.throws(() => follow(`${NPM}\\codex.cmd`, forProgram('gone.exe')), told)
  assert.throws(() => follow(`${NPM}\\codex.cmd`, forNode('node_modules\\codex\\bin\\codex.js')), told)
  assert.throws(() => follow(`${NPM}\\codex.cmd`, forProgram('other.cmd'), [`${NPM}\\other.cmd`]), told)
  assert.throws(() => follow(`${NPM}\\codex.cmd`, '@echo off\r\necho hello\r\n'), told)
  assert.throws(() => launcher(`${NPM}\\codex.cmd`), told)
})
