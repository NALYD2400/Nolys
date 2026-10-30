import assert from 'node:assert/strict';
import {test} from 'node:test';
let invoke;
globalThis.window={__TAURI__:{core:{invoke:(...args)=>invoke(...args)},webviewWindow:{getCurrentWebviewWindow:()=>({listen:async()=>()=>{}})}}};
const {volumeMethods}=await import('../../src/island/dynamic-island/features/volume.js');

test('wheel adjustment preserves zero and serializes rapid volume changes', async () => {
    let value=0;
    const writes=[], shown=[];
    invoke=async (command,args) => {
        await new Promise(resolve=>setTimeout(resolve,2));
        if(command==='get_system_volume') return value;
        assert.equal(command,'set_system_volume');
        writes.push(args.volume); value=args.volume; return true;
    };
    const host={...volumeMethods,showVolumeIndicator:v=>shown.push(v)};
    await Promise.all([host.adjustVolume(5),host.adjustVolume(5),host.adjustVolume(-20),host.adjustVolume(-5)]);
    assert.deepEqual(writes,[5,10,0,0]); assert.deepEqual(shown,writes);
    invoke=async()=>null;
    await host.adjustVolume(5); assert.equal(writes.length,4,'an unknown volume never becomes a fabricated50%');
});

test('a refused or failed write is reported without blocking subsequent wheel requests', async () => {
    let errors=0, shown=0;
    const host={...volumeMethods,showIslandFeedback:()=>errors++,showVolumeIndicator:()=>shown++};
    invoke=async()=>{throw Error('device unavailable');};
    await host.adjustVolume(5); assert.equal(errors,1);
    invoke=async command=>command==='get_system_volume'?0:false;
    await host.adjustVolume(5); assert.equal(shown,0);
    invoke=async command=>command==='get_system_volume'?0:true;
    await host.adjustVolume(5); assert.equal(shown,1);
});
