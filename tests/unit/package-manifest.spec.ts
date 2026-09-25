import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

interface PackageManifest {
  readonly name?: string
  readonly version?: string
  readonly license?: string
  readonly private?: boolean
  readonly scripts?: { readonly 'pack:check'?: string }
  readonly files?: readonly string[]
  readonly types?: string
  readonly exports?: {
    readonly '.': { readonly types?: string }
    readonly './client': { readonly types?: string }
  }
}

it('publishes the stable Better Composer identity under the repository license', () => {
  const manifestPath = fileURLToPath(new URL('../../package.json', import.meta.url))
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest
  expect(manifest.name).toBe('@cheesefox/dsh-better-composer')
  expect(manifest.version).toBe('1.0.0')
  expect(manifest.license).toBe('MIT')
  expect(manifest.private).toBeUndefined()
})

interface TypeScriptConfig {
  readonly compilerOptions?: { readonly declaration?: boolean }
}

it('builds the client artifact before the package check', () => {
  const manifestPath = fileURLToPath(new URL('../../package.json', import.meta.url))
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest
  expect(manifest.scripts?.['pack:check']).toBe('pnpm run bundle && pnpm pack --pack-destination .pack-check')
})

it('ships only the runtime documentation entrypoint instead of historical evidence', () => {
  const manifestPath = fileURLToPath(new URL('../../package.json', import.meta.url))
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest
  expect(manifest.files).toEqual([
    'lib/index.js',
    'lib/client.js',
    'lib/types/**/*.d.ts',
    'cordis.patch.yml',
    'README.md',
    'README.zh.md',
    'LICENSE',
  ])
})

it('emits the declaration files named by the package entrypoints', () => {
  const manifestPath = fileURLToPath(new URL('../../package.json', import.meta.url))
  const tsconfigPath = fileURLToPath(new URL('../../tsconfig.json', import.meta.url))
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest
  const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8')) as TypeScriptConfig
  expect(manifest.types).toBe('lib/types/index.d.ts')
  expect(manifest.exports?.['.'].types).toBe('./lib/types/index.d.ts')
  expect(manifest.exports?.['./client'].types).toBe('./lib/types/client/index.d.ts')
  expect(tsconfig.compilerOptions?.declaration).toBe(true)
})

it('does not advertise source exports that the packed artifact does not ship', () => {
  const manifestPath = fileURLToPath(new URL('../../package.json', import.meta.url))
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest
  expect(manifest.exports?.['./src/*']).toBeUndefined()
})
