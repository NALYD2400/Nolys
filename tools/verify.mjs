// Safe default: pure JS, UI build and Rust tests. Hardware tests stay opt-in.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const requested = new Set(process.argv.slice(2));
for (const flag of requested) if (!['--unit', '--ui', '--rust', '--browser', '--audit'].includes(flag)) throw new Error(`Option inconnue : ${flag}`);
const selected = requested.size ? requested : new Set(['--unit', '--ui', '--rust']);
const testDir = path.join(root, 'tools/tests');

async function run(label, command, args, env = process.env) {
    console.log(`\n${label}`);
    await new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, env });
        child.once('error', reject);
        child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${label} : code ${code ?? signal}`)));
    });
}
function npmCli() {
    const candidates = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')];
    const result = candidates.find(file => file && existsSync(file));
    if (!result) throw new Error('Lancez ce contrôle via npm run check:audit pour utiliser le même npm que le projet.');
    return result;
}
async function browserChecks() {
    if (process.platform !== 'win32') throw new Error('Les parcours navigateur utilisent Microsoft Edge sur Windows.');
    const require = createRequire(import.meta.url);
    let modulePath;
    try { modulePath = process.env.NOLYS_PLAYWRIGHT_MODULE || require.resolve('playwright'); require(modulePath); }
    catch { throw new Error('Playwright manque : définissez NOLYS_PLAYWRIGHT_MODULE vers une installation de cet outil, hors des dépendances de Nolys. Voir docs/verification.md.'); }
    // Choose a separate localhost port: never reuse or terminate the user's dev server.
    const port = await new Promise((resolve, reject) => {
        const probe = net.createServer(); probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); });
    });
    const base = `http://127.0.0.1:${port}`;
    const { createServer } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')));
    const server = await createServer({ configFile: path.join(root, 'vite.config.js'), server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
    try {
        await server.listen();
        const env = { ...process.env, NOLYS_UI_URL: base, NOLYS_PLAYWRIGHT_MODULE: modulePath };
        for (const file of readdirSync(testDir).filter(f => f.endsWith('.browser.cjs')).sort()) await run(`Navigateur · ${file}`, process.execPath, [path.join(testDir, file)], env);
    } finally {
        await server.close();
    }
}

try {
    if (selected.has('--unit')) await run('Tests JavaScript', process.execPath, ['--test', ...readdirSync(testDir).filter(f => f.endsWith('.test.mjs')).sort().map(f => path.join(testDir, f))]);
    if (selected.has('--ui')) await run('Compilation interface', process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build']);
    if (selected.has('--rust')) {
        if (process.platform !== 'win32') throw new Error('Les tests natifs Nolys doivent être exécutés sur Windows.');
        await run('Tests Rust (hors tests ignorés matériels)', 'cargo', ['test', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--lib']);
    }
    if (selected.has('--browser')) await browserChecks();
    if (selected.has('--audit')) {
        await run('Audit npm', process.execPath, [npmCli(), 'audit', '--audit-level=high']);
        const local = path.join(root, '.impeccable/runtime/audit-tools/bin', process.platform === 'win32' ? 'cargo-audit.exe' : 'cargo-audit');
        const audit = process.env.NOLYS_CARGO_AUDIT || (existsSync(local) ? local : null);
        await run('Audit RustSec', audit || 'cargo', ['audit', '--file', 'src-tauri/Cargo.lock']);
    }
    console.log('\nContrôles demandés réussis. Les tests matériels et la CSP du binaire release restent distincts.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
