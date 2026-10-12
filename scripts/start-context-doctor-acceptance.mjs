import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'

const dshRoot = process.argv[2] && resolve(process.argv[2])
if (!dshRoot) throw new Error('Usage: node scripts/start-context-doctor-acceptance.mjs /path/to/deepseek-harness')
const pluginRoot = fileURLToPath(new URL('../', import.meta.url))
const corpusPath = process.argv[3] && resolve(process.argv[3])
const acceptanceHome = await mkdtemp(join(tmpdir(), 'context-doctor-acceptance-'))
const env = { ...process.env, DSH_HOME: acceptanceHome, DSH_TELEMETRY_DISABLED: '1' }
const manifest = JSON.parse(await readFile(join(pluginRoot, 'package.json'), 'utf8'))
console.log(`DSH_HOME=${acceptanceHome}\nPackage=${manifest.name}@${manifest.version}`)
for (const file of ['index.js', 'client.js', 'doctor-compaction.js']) {
  console.log(`${file} sha256=${createHash('sha256').update(await readFile(join(pluginRoot, 'lib', file))).digest('hex')}`)
}
console.log(corpusPath ? 'Read-only copies of selected real sessions; no credentials copied and no model requests started.' : 'Keyless local fixtures; no credentials copied and no model requests started.')
const linked = spawnSync('pnpm', ['dsh', 'plugin', '--profile', 'web', 'link', pluginRoot], { cwd: dshRoot, env, stdio: 'inherit' })
if (linked.status !== 0) { await rm(acceptanceHome, { recursive: true, force: true }); process.exit(linked.status ?? 1) }
await symlink(join(dshRoot, 'node_modules'), join(acceptanceHome, 'node_modules'))
await mkdir(join(acceptanceHome, 'fixture-workspace'))
if (corpusPath) await writeFile(join(acceptanceHome, 'real-corpus.json'), await readFile(corpusPath), { mode: 0o600 })
const seedPath = join(acceptanceHome, 'fixture-seed.mjs')
await writeFile(seedPath, `
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { createUserMessage, createAssistantMessage } from '@deepseek-ai/dsh-llm'
export const inject = ['sessionPersistence', 'agentPresets', 'workspaceRegistry', 'appReady']
export function apply(ctx) {
  ctx.effect(() => ctx.appReady.onReady(() => {
    console.log('Doctor capabilities=' + JSON.stringify(ctx.get('betterComposerDoctor', false)?.capabilities()))
    void seed(ctx).catch(error => ctx.logger.error(error))
  }))
}
async function seed(ctx) {
  const modes = await ctx.agentPresets.list()
  const workspace = await ctx.workspaceRegistry.create(${JSON.stringify(join(acceptanceHome, 'fixture-workspace'))}, 'Context Doctor 本地验收')
  if (${Boolean(corpusPath)}) {
    const corpus = JSON.parse(await readFile(${JSON.stringify(join(acceptanceHome, 'real-corpus.json'))}, 'utf8'))
    const imported = []
    for (const sample of corpus) {
      const restore = sessionFormatCatalog.createRestore(sample.header, { recovery: 'strict', validation: 'current' })
      for (const row of sample.rows) restore.decodeRow(row)
      const artifact = restore.finish()
      const header = { ...artifact.header, cwd: ${JSON.stringify(join(acceptanceHome, 'fixture-workspace'))} }
      const handle = await ctx.sessionPersistence.create(header, artifact.inheritedEventCount ? { inheritedEventCount: artifact.inheritedEventCount } : undefined)
      await handle.append(artifact.events)
      await handle.flush()
      await handle.close()
      await workspace.attachSession(header.id)
      imported.push({ id: header.id, mode: header.agentPreset, events: artifact.events.length, originalCwd: sample.header.cwd, source: sample.source, sourceSha256: sample.sha256 })
      console.log('Real session=' + header.id + ' events=' + artifact.events.length)
    }
    await writeFile(${JSON.stringify(join(acceptanceHome, 'real-session-import.json'))}, JSON.stringify(imported, null, 2), { mode: 0o600 })
    return
  }
  for (const [index, count] of [2, 1, 2].entries()) {
    const modeId = modes[index === 2 ? Math.min(1, modes.length - 1) : 0]?.id
    const id = SessionId(randomUUID())
    const events = []
    const append = (type, data, surfaceOp) => events.push({ type, seq: SessionSeq(events.length), time: Date.now(), data, ...(surfaceOp ? { surfaceOp } : {}) })
    for (let turn = 1; turn <= count; turn++) {
      append('turn/start', { turn })
      append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '[Context Doctor 本地验收 fixture ' + index + '] ' + (turn > 1 ? '补充：请保留条件和例外。' : '这是静态测试样本，不是实际模型运行。请只做设计。') }] }), 'append')
      append('step/start', { turn, step: 1 })
      append('assistant/message', { turn, step: 1, message: createAssistantMessage({ source: { provider: 'fixture', model: 'static' }, content: [{ type: 'text', text: '本地 fixture 回应：已记录设计范围。' }] }), stream: [] }, 'append')
      append('step/end', { turn, step: 1 })
      append('turn/end', { turn, reason: { kind: 'completed' } })
    }
    const handle = await ctx.sessionPersistence.create({ version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(), isSeeded: false, cwd: ${JSON.stringify(join(acceptanceHome, 'fixture-workspace'))}, ...(modeId ? { agentPreset: modeId } : {}) })
    await handle.append(events)
    await handle.flush()
    await handle.close()
    await workspace.attachSession(id)
    console.log('Fixture session=' + id + ' mode=' + modeId + ' exchanges=' + count)
  }
}
`)
const overlay = join(acceptanceHome, 'fixture.patch.yml')
await writeFile(overlay, `- insert:\n    - id: context-doctor-local-fixtures\n      name: ${JSON.stringify(seedPath)}\n`)
const child = spawn('pnpm', ['dsh', 'web', '--patch', join(pluginRoot, 'cordis.patch.yml'), '--patch', join(dshRoot, 'apps/web/tests/pin-browse-picker.overlay.yml'), '--patch', overlay, '--port', '0', '--no-open'], { cwd: dshRoot, env, stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', async (code) => { await rm(acceptanceHome, { recursive: true, force: true }); process.exit(code ?? 0) })
