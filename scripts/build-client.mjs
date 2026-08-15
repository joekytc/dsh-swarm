import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = join(root, 'lib', 'client.js');

const result = await build({
  entryPoints: [join(root, 'client', 'index.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  // 浏览器半外部依赖：由 client 模块系统的 __ModuleLoader__.require 提供
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-runtime/client', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-layout/client'],
  jsx: 'automatic',
  loader: { '.css': 'text' },
  write: false,
  logLevel: 'info',
  target: 'es2020',
});

const factoryBody = result.outputFiles[0].text;
const wrapped = `window.__ModuleLoader__.load({
	id: "dsh-kanban",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${factoryBody.split('\n').map((l) => '\t\t' + l).join('\n')}
		return module.exports;
	}
});
`;

mkdirSync(dirname(outfile), { recursive: true });
writeFileSync(outfile, wrapped);
console.log('build:client ->', outfile, '(' + wrapped.length + ' bytes)');
