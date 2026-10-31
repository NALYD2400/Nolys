const {spawn} = require('node:child_process');
const path = require('node:path');
(async()=>{
    for(const args of [[],['--edges']]) {
        const code=await new Promise((resolve,reject)=>{
            const child=spawn(process.execPath,[path.join(__dirname,'control-center.browser.mjs'),...args],{stdio:'inherit',env:process.env,windowsHide:true});
            child.on('error',reject);child.on('exit',resolve);
        });
        if(code!==0) throw Error(`Parcours centre de contrôle échoué (${args.join(' ') || 'actions'}).`);
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
