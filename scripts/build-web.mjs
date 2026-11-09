/** Bundle the shared UI using an explicitly selected official DSH UI primitives package. */
import { build } from 'esbuild'
import { copyFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'

const primitives = process.env.DSH_UI_PRIMITIVES
if (!primitives) throw new Error('Set DSH_UI_PRIMITIVES to the official UI primitives lib/index.js')
const require = createRequire(import.meta.url)
const source = resolve(dirname(primitives), '../src').replaceAll('\\', '/')
const exports = ['Button', 'Input', 'Switch', 'Menu', 'Checkbox', 'Tag', 'StateDot', 'Modal', 'Toast']
  .map(name => `export { ${name} } from ${JSON.stringify(`${source}/${name}.tsx`)};`).join('\n')
  + `\nexport { IconPlusOutlineRegular, IconChevronDownOutlineRegular, IconTrashOutlineRegular } from ${JSON.stringify(`${source}/icons/index.tsx`)};`
const output = process.env.WAIMAI_WEB_OUT_DIR || 'lib/web'
await mkdir(output, { recursive: true })
await build({ entryPoints: ['web-src/app.js'], outfile: resolve(output, 'app.js'), bundle: true, format: 'esm', target: 'es2022',
  minify: true, jsx: 'automatic', legalComments: 'linked', loader: { '.module.css': 'local-css' },
  plugins: [{ name: 'selected-official-primitives', setup(builder) {
    builder.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'selected', namespace: 'waimai-ui' }))
    builder.onLoad({ filter: /.*/, namespace: 'waimai-ui' }, () => ({ contents: exports, resolveDir: source }))
  } }],
  alias: { react: resolve(require.resolve('react'), '..'), 'react-dom': resolve(require.resolve('react-dom'), '..') },
  define: { 'process.env.NODE_ENV': '"production"' } })
await copyFile('web-src/index.html', resolve(output, 'index.html'))
