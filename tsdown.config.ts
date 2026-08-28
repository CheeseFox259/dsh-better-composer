import type { UserConfig } from 'tsdown'
import { fileURLToPath } from 'node:url'

const PACKAGE_ID = '@deepseek-ai/dsh-rich-editor'
const PACKAGE_ROOT = fileURLToPath(new URL('.', import.meta.url))

const nodeConfig: UserConfig = {
  name: PACKAGE_ID,
  entry: [`${PACKAGE_ROOT}/lib/types/index.js`],
  outDir: `${PACKAGE_ROOT}/lib`,
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}

const clientConfig: UserConfig = {
  name: `${PACKAGE_ID}/client`,
  entry: { client: `${PACKAGE_ROOT}/src/client/index.ts` },
  outDir: `${PACKAGE_ROOT}/lib`,
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: { alwaysBundle: () => true },
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
