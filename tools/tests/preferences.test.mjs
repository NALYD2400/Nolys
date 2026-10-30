import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readJSON, readRecord} from '../../src/shared/safe-storage.js';
import {sanitizeSettings, validateBackup} from '../../src/settings/state/validation.js';
import {offlineArt} from '../../src/shared/privacy.js';
import {preferenceTransaction} from '../../src/settings/state/preference-transaction.js';

function storage(value) {
    const entries = new Map(Object.entries(value));
    return {getItem:k=>entries.get(k) ?? null,setItem:(k,v)=>entries.set(k,String(v)), entries};
}
test('damaged syntax and valid JSON with wrong type are preserved before startup recovery', () => {
    for(const raw of ['{oops','null','[]','42','"value"']) {
        const store = storage({liquid_island_config:raw});
        assert.deepEqual(readRecord('liquid_island_config', {}, store), {});
        assert.equal(store.getItem('liquid_recovery_liquid_island_config'),raw);
        assert.equal(store.getItem('liquid_island_config'),'{}');
    }
    const readOnly = {getItem:()=>'{oops',setItem:()=>{throw Error('quota');}};
    assert.deepEqual(readJSON('key', [],Array.isArray,readOnly),[]);
});
test('invalid imported settings cannot alter files and older compatible backups remain accepted', () => {
    const payload = {type:'liquid-dynamic-island-settings',version:1,settings:{glow:{opacity:92},shortcuts:[{name:'Explorer',cmd:'explorer.exe'}]}};
    assert.equal(validateBackup(payload),payload);
    for(const bad of [{...payload,version:99}, {...payload,settings:{glow:null}}, {...payload,settings:{shortcuts:[null]}}, {...payload,settings:{wallpaperDelay:-2}}, {...payload,profiles:[{id:'a',name:'n',settings:null}]}, {...payload,uiValues:{other:'x'}}, {...payload,uiValues:{liquid_island_config:'[]'}}]) assert.throws(()=>validateBackup(bad));
});
test('bounded settings preserve zero, valid choices and native defaults', () => {
    const defaults = sanitizeSettings({});
    assert.equal(defaults.motion,'fluid'); assert.equal(defaults.wallpaperBlurIntensity,'moderate');
    const value=sanitizeSettings({opacity:Infinity,blur:-10,wallpaperDelay:0,pillCoverShape:'rounded',vizColorMode:'cyberpunk',shortcuts:[null],weatherCity:42});
    assert.equal(value.opacity,92); assert.equal(value.blur,0); assert.equal(value.wallpaperDelay,0);
    assert.equal(value.pillCoverShape,'rounded'); assert.equal(value.vizColorMode,'cyberpunk');
    assert.equal(value.shortcuts.length,4); assert.equal(value.weatherCity,'');
});
test('offline artwork keeps embedded images and blocks remote images', async () => {
    globalThis.localStorage = storage({liquid_offline_mode:'true'});
    assert.equal(offlineArt('https://example.com/cover.jpg'),'');
    assert.equal(offlineArt('//example.com/cover.jpg'),'');
    assert.equal(offlineArt('data:image/png;base64,AA'),'data:image/png;base64,AA');
    const {APP_ICONS}=await import('../../src/island/dynamic-island/helpers/media-art.js');
    assert.ok(Object.values(APP_ICONS).every(v=>v.startsWith('data:image/svg+xml,')));
    delete globalThis.localStorage;
});

test('local rollback failures never prevent native rollback and all failures remain visible', async () => {
    const attempted=[];
    await assert.rejects(preferenceTransaction(async()=>{throw Error('disk full');},[
        ()=>{attempted.push('local');throw Error('quota');},
        ()=>{attempted.push('persist');throw Error('unwritable');},
        ()=>{attempted.push('native');},
    ]),error=>/disk full/.test(error.message)&&/quota/.test(error.message)&&/unwritable/.test(error.message));
    assert.deepEqual(attempted,['local','persist','native']);
    let rolledBack=false;
    assert.equal(await preferenceTransaction(async()=>42,[()=>{rolledBack=true;}]),42);
    assert.equal(rolledBack,false);
});
