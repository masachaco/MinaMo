import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Writes THIRD_PARTY_LICENSES.txt (the license of every npm package that ends up in the build) and LICENSE into
 * dist/, since the minified bundle drops the libraries' license comments.
 */
function licenses(): Plugin {
  return {
    name: 'third-party-licenses',
    apply: 'build',
    generateBundle() {
      const pkgs = new Map<string, string>();
      for (const id of this.getModuleIds()) {
        const m = id.replace(/\\/g, '/').match(/\/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
        if (m) pkgs.set(m[1], path.join('node_modules', m[1]));
      }
      const out = ['Third-party software included in MinaMo', ''];
      for (const [name, dir] of [...pkgs].sort(([a], [b]) => a.localeCompare(b))) {
        const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
        out.push('='.repeat(78), `${name}@${pj.version}  (${pj.license ?? 'see below'})`);
        const repo = typeof pj.repository === 'string' ? pj.repository : pj.repository?.url;
        if (repo) out.push(`Source: ${repo.replace(/^git\+/, '')}`);
        out.push('', file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : '(no license file in the package)', '');
      }
      // files that are not npm packages: third-party/<name>/LICENSE (e.g. the GitHub mark from Octicons in index.html)
      for (const name of fs.existsSync('third-party') ? fs.readdirSync('third-party').sort() : []) {
        const file = path.join('third-party', name, 'LICENSE');
        const src = path.join('third-party', name, 'SOURCE');
        const about = fs.existsSync(src) ? fs.readFileSync(src, 'utf8').trim() : name;
        if (fs.existsSync(file)) out.push('='.repeat(78), about, '', fs.readFileSync(file, 'utf8').trim(), '');
      }
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_LICENSES.txt', source: out.join('\n') });
      this.emitFile({ type: 'asset', fileName: 'LICENSE', source: fs.readFileSync('LICENSE', 'utf8') });
    },
  };
}

/**
 * Dev server only: /test-song is the song the browser tests and the test page (test.html) use — a local
 * music_bgm_200.wav if there is one (git-ignored), else the demo song in public/demo.
 */
function testSong(): Plugin {
  return {
    name: 'test-song',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/test-song', (_req, res) => {
        const wav = fs.existsSync('music_bgm_200.wav');
        res.setHeader('Content-Type', wav ? 'audio/wav' : 'audio/mpeg');
        fs.createReadStream(wav ? 'music_bgm_200.wav' : 'public/demo/music_bgm_200.mp3').pipe(res);
      });
    },
  };
}

export default defineConfig({
  // relative paths: the build works from any folder (GitHub Pages serves it under /<repo>/)
  base: './',
  server: { port: 5178 },
  build: { target: 'es2022' },
  plugins: [licenses(), testSong()],
});
