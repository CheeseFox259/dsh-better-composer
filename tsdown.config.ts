import type { UserConfig } from 'tsdown'
import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'

const PACKAGE_ID = '@cheesefox/dsh-better-composer'
const nodeConfig: UserConfig = {
  name: PACKAGE_ID,
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  // Lowers TC39 decorators (@Remote) in TypeScript sources. The package-mode
  // generation pass skips us: no ./typert or ./remote export is declared, and
  // the repo-root tsconfig.host.json only exists to satisfy its root probe.
  plugins: [typertPlugin({ mode: 'package' })],
}

const clientConfig: UserConfig = {
  name: `${PACKAGE_ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [nodeConfig, clientConfig]
