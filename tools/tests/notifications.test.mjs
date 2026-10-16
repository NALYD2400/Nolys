import assert from 'node:assert/strict';
import { test } from 'node:test';

// Le pont natif n'intervient pas dans le cycle de vie des alertes.
globalThis.window = { __TAURI__: { webviewWindow: { getCurrentWebviewWindow: () => ({}) } } };
globalThis.localStorage = { getItem: () => null };
const { navigationMethods } = await import('../../src/island/dynamic-island/features/navigation.js');
const { notificationMethods } = await import('../../src/island/dynamic-island/features/notifications.js');
const { notificationView } = await import('../../src/island/dynamic-island/views/notification.js');
const { SoundService } = await import('../../src/services/SoundService.js');

function classList() {
    const classes = new Set();
    return {
        add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        contains: name => classes.has(name),
    };
}

function islandFor(t, mode = 'music', isExpanded = false) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(SoundService, 'play', () => {});
    t.mock.method(localStorage, 'getItem', () => null);
    const noop = () => {};
    const island = {
        ...navigationMethods, ...notificationMethods, ...notificationView,
        mode, isExpanded, _transitionToken: 0,
        musicData: { isPlaying: true },
        el: { classList: classList(), style: {} },
        content: { classList: classList(), innerHTML: '' },
        releaseGlassControls: noop, hasGlassSurfaces: () => false,
        syncVisualizerActivity: noop, syncGlobalCoverAesthetics: noop,
        updateMediaState: noop, updateAudioSessions: noop,
        renderIdle() {
            this.el.classList.add('island-active-music');
            this.el.style.width = '240px';
            this.content.innerHTML = 'music';
        },
        renderMenu() { this.content.innerHTML = 'menu'; },
        renderMixer() { this.content.innerHTML = 'mixer'; },
        renderControl() { this.content.innerHTML = 'control'; },
    };
    island.renderContent();
    return island;
}

// Avance aussi les étapes asynchrones de la vraie animation (90 + 200 + 40 ms).
async function advance(t, duration) {
    for (let elapsed = 0; elapsed < duration; elapsed += 10) {
        t.mock.timers.tick(Math.min(10, duration - elapsed));
        await Promise.resolve();
        await Promise.resolve();
    }
}

for (const [mode, expanded] of [['music', false], ['menu', true], ['mixer', true]]) {
    test(`alerte compacte puis retour exact à ${mode}`, async t => {
        const island = islandFor(t, mode, expanded);
        island.showNotification('Nolys', 'Un message');
        await advance(t, 400);
        assert.equal(island.mode, 'notification');
        assert.equal(island.isExpanded, false);
        assert.equal(island.el.classList.contains('island-notifying'), true);
        assert.equal(island.el.style.height, '');
        assert.equal(island.el.style.width, '');
        assert.equal(island.el.classList.contains('island-active-music'), false);
        await advance(t, 4400);
        assert.equal(island.mode, mode);
        assert.equal(island.isExpanded, expanded);
        assert.equal(island.content.innerHTML, mode);
        assert.equal(island.el.classList.contains('island-notifying'), false);
    });
}

test('le détail reste lisible au-delà du délai et se ferme sur le panneau précédent', async t => {
    const island = islandFor(t, 'menu', true);
    island.showNotification('Nolys', 'Message à lire');
    await advance(t, 400);
    island.expandNotification();
    await advance(t, 8500);
    assert.equal(island.mode, 'notification');
    assert.equal(island.isExpanded, true);
    assert.equal(island.notifTimeout, null);
    assert.match(island.content.innerHTML, /notif-dismiss/);
    island.dismissNotification();
    await advance(t, 400);
    assert.equal(island.mode, 'menu');
    assert.equal(island.isExpanded, true);
});

test('plusieurs alertes pendant une animation gardent le dernier message et le bon retour', async t => {
    const island = islandFor(t, 'menu', true);
    island.showNotification('Première', 'Ancien message');
    await advance(t, 40);
    island.showNotification('Deuxième', 'Dernier message');
    await advance(t, 800);
    assert.equal(island.notificationData.title, 'Deuxième');
    assert.deepEqual(island._notificationReturnState, { mode: 'menu', isExpanded: true });
    await advance(t, 4400);
    assert.equal(island.mode, 'menu');
});

test('une alerte attend la fin de la navigation avant de mémoriser le panneau', async t => {
    const island = islandFor(t);
    island.openExpandedMode('mixer');
    await advance(t, 40);
    island.showNotification('Nolys', 'Message');
    await advance(t, 800);
    assert.deepEqual(island._notificationReturnState, { mode: 'mixer', isExpanded: true });
    island.dismissNotification();
    await advance(t, 400);
    assert.equal(island.mode, 'mixer');
    assert.equal(island.isExpanded, true);
});

test('une nouvelle alerte pendant la fermeture ne se fait pas effacer', async t => {
    const island = islandFor(t);
    island.showNotification('Première', 'Message');
    await advance(t, 400);
    island.dismissNotification();
    await advance(t, 40);
    island.showNotification('Deuxième', 'Message suivant');
    await advance(t, 800);
    assert.equal(island.mode, 'notification');
    assert.equal(island.notificationData.title, 'Deuxième');
    await advance(t, 4400);
    assert.equal(island.mode, 'music');
});

test('un clic au début de la fermeture permet encore de lire le détail', async t => {
    const island = islandFor(t);
    island.showNotification('Nolys', 'Message');
    await advance(t, 4320);
    island.expandNotification();
    await advance(t, 8500);
    assert.equal(island.mode, 'notification');
    assert.equal(island.isExpanded, true);
});

test('la navigation manuelle annule le retour automatique de la notification', async t => {
    const island = islandFor(t, 'menu', true);
    island.showNotification('Nolys', 'Message');
    await advance(t, 400);
    island.openExpandedMode('control');
    await advance(t, 5000);
    assert.equal(island.mode, 'control');
    assert.equal(island.notifTimeout, null);
    assert.equal(island.notificationData, null);
});

test('un retour au repos annule une notification encore en attente', async t => {
    const island = islandFor(t);
    island.showNotification('Nolys', 'Message');
    island.returnToMusicIdle();
    await advance(t, 5000);
    assert.equal(island.mode, 'music');
    assert.equal(island.notificationData, null);
});

test('Focus, notifications désactivées et placement restent silencieux', t => {
    const island = islandFor(t);
    for (const [key, value] of [['liquid_focus_mode', 'true'], ['liquid_notifications_enabled', 'false']]) {
        localStorage.getItem.mock.mockImplementation(name => name === key ? value : null);
        island.showNotification('Nolys', 'Message');
        assert.equal(island._notificationRequest, undefined);
    }
    localStorage.getItem.mock.mockImplementation(() => null);
    island._layoutEditMode = true;
    island.showNotification('Nolys', 'Message');
    assert.equal(island.notificationData, undefined);
    assert.equal(SoundService.play.mock.callCount(), 0);
});

test('le texte de la notification est échappé et les rendus ne prolongent pas le délai', async t => {
    const island = islandFor(t);
    island.showNotification('<img src=x>', '<script>alert(1)</script>');
    await advance(t, 400);
    assert.match(island.content.innerHTML, /&lt;img/);
    assert.doesNotMatch(island.content.innerHTML, /<script>/);
    const timeout = island.notifTimeout;
    await advance(t, 2000);
    island.renderContent();
    assert.equal(island.notifTimeout, timeout);
    await advance(t, 2400);
    assert.equal(island.mode, 'music');
});

test('activer Focus pendant le remplacement dune alerte restaure le panneau précédent', async t => {
    const island = islandFor(t, 'menu', true);
    island.showNotification('Première', 'Message');
    await advance(t, 400);
    island.showNotification('Deuxième', 'Message suivant');
    localStorage.getItem.mock.mockImplementation(name => name === 'liquid_focus_mode' ? 'true' : null);
    await advance(t, 5000);
    assert.equal(island.mode, 'menu');
    assert.equal(island.isExpanded, true);
    assert.equal(island.notifTimeout, null);
});
