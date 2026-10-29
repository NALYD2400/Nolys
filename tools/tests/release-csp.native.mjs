// Exécuter contre le vrai .exe release, lancé avec
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9225.
// Aucun serveur Vite ni pont Tauri simulé : la CSP doit être celle embarquée par Tauri.
import assert from 'node:assert/strict';

const endpoint = process.env.NOLYS_CDP_URL || 'http://127.0.0.1:9225';
const targets = await (await fetch(`${endpoint}/json/list`)).json();
const target = targets.find(item => item.url === 'http://tauri.localhost/island/index.html');
assert.ok(target, 'Ouvrir le .exe release avec le port de diagnostic WebView2');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    pending.get(message.id)?.(message);
    pending.delete(message.id);
};
function call(method, params = {}) {
    return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Délai dépassé : ${method}`)); }, 10000);
        pending.set(id, message => { clearTimeout(timeout); resolve(message); });
        socket.send(JSON.stringify({ id, method, params }));
    });
}
try {
    const response = await call('Runtime.evaluate', {
        expression: `(${async function () {
            const violations = [];
            const onViolation = event => violations.push(event.effectiveDirective);
            document.addEventListener('securitypolicyviolation', onViolation);
            const probe = document.createElement('div');
            probe.style.position = 'fixed';
            probe.style.left = '-10000px';
            // Les vues utilisent innerHTML : une affectation par style.width contournerait
            // le problème et ferait passer ce test même avec la CSP défectueuse.
            probe.innerHTML = '<div style="width:137px;height:19px;color:rgb(12,34,56)">CSP</div>';
            const script = document.createElement('script');
            script.textContent = 'window.__nolysInlineProbe = true';
            try {
                document.body.append(probe);
                const style = getComputedStyle(probe.firstElementChild);
                const result = { width: style.width, height: style.height, color: style.color };
                document.head.append(script);
                await new Promise(resolve => setTimeout(resolve, 100));
                return { ...result, inlineScriptRan: window.__nolysInlineProbe === true, violations };
            } finally {
                probe.remove();
                script.remove();
                delete window.__nolysInlineProbe;
                document.removeEventListener('securitypolicyviolation', onViolation);
            }
        }})()`,
        returnByValue: true,
        awaitPromise: true,
    });
    assert.ok(!response.error && !response.result.exceptionDetails, JSON.stringify(response));
    const result = response.result.result.value;
    console.log(JSON.stringify(result));
    assert.equal(result.width, '137px', 'Les styles HTML des vues doivent être appliqués en release');
    assert.equal(result.height, '19px');
    assert.equal(result.color, 'rgb(12, 34, 56)');
    assert.equal(result.inlineScriptRan, false, 'Le JavaScript en ligne doit rester interdit');
    assert.ok(!result.violations.includes('style-src-attr'));
    assert.ok(result.violations.includes('script-src-elem'));
    console.log('Release CSP : styles des vues autorisés, scripts en ligne bloqués.');
} finally {
    socket.close();
}
