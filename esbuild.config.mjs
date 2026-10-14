// The build of the Obsidian sample plugin: one CommonJS bundle, `main.js`, at the repository root,
// beside `manifest.json`. Obsidian loads those two files (and `styles.css` when one exists).
import { builtinModules } from 'node:module';
import esbuild from 'esbuild';

const production = process.argv[2] === 'production';

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  // Obsidian provides these modules at run time. A bundled copy would be a second, wrong copy.
  external: [
    'obsidian',
    'electron',
    '@electron/remote',
    '@codemirror/*',
    '@lezer/*',
    ...builtinModules,
    ...builtinModules.map((name) => `node:${name}`),
  ],
  format: 'cjs',
  target: 'es2022',
  platform: 'browser',
  logLevel: 'info',
  sourcemap: production ? false : 'inline',
  treeShaking: true,
  minify: production,
  outfile: 'main.js',
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
