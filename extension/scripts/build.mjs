import { build } from 'esbuild';
import { rmSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { join } from 'path';

const outdir = 'dist';
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const entryPoints = {
  'background': 'src/background/background.ts',
  'contentScript': 'src/content/contentScript.ts',
  'popup': 'src/popup/popup.ts',
  'options': 'src/options/options.ts'
};

const buildOptions = {
  entryPoints,
  bundle: true,
  outdir,
  entryNames: '[name]',
  sourcemap: process.argv.includes('--watch') ? 'inline' : false,
  minify: false,
  target: 'chrome110',
  format: 'esm',
  logLevel: 'info',
  define: {
    'process.env.API_BASE_URL': JSON.stringify(process.env.API_BASE_URL || ''),
    'process.env.AI_ANALYSIS_URL': JSON.stringify(process.env.AI_ANALYSIS_URL || ''),
    'process.env.PREMIUM_REDIRECT_URL': JSON.stringify(process.env.PREMIUM_REDIRECT_URL || '')
  }
};

if (process.argv.includes('--watch')) {
  const { context } = await import('esbuild');
  const ctx = await context(buildOptions);
  await ctx.watch();
  console.log('Watching for changes...');
  
  // Keep the process running in watch mode
  process.on('SIGINT', async () => {
    await ctx.dispose();
    process.exit(0);
  });
} else {
  await build(buildOptions);
}

// Copy static HTML/CSS & manifest
copyFileSync('manifest.json', join(outdir, 'manifest.json'));

// HTML files
for (const file of ['popup.html', 'options.html']) {
  copyFileSync(`src/${file.split('.')[0]}/${file}`, join(outdir, file));
}

// CSS files
copyFileSync('src/popup/popup.css', join(outdir, 'popup.css'));
copyFileSync('src/options/options.css', join(outdir, 'options.css'));

// Icons (placeholder)
try {
  mkdirSync(join(outdir, 'icons'), { recursive: true });
  const iconFiles = readdirSync('icons');
  for (const f of iconFiles) {
    if (f.endsWith('.png')) {
      copyFileSync(`icons/${f}`, join(outdir, 'icons', f));
    }
  }
  console.log('Icons copied successfully');
} catch (error) {
  console.warn('Failed to copy icons:', error.message);
}

console.log('Build complete');
