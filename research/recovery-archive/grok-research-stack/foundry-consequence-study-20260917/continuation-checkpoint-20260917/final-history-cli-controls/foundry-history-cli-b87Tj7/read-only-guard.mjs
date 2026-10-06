import {registerHooks,syncBuiltinESMExports} from 'node:module';
import fs from 'node:fs';import net from 'node:net';import child from 'node:child_process';
const no=()=>{throw new Error('Read-only history forbids host dispatch and JS writes');};
globalThis.fetch=no;net.Socket.prototype.connect=no;
for(const key of ['writeFileSync','appendFileSync','mkdirSync','unlinkSync','rmSync','chmodSync'])fs[key]=no;
for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])child[key]=no;
syncBuiltinESMExports();
registerHooks({load(url,context,next){if(url==="file:///home/raed/Projects/workflow-foundry/src/components.mjs")return{format:'module',shortCircuit:true,source:'export async function loadComponents(){throw new Error("Components must not be loaded")}'};return next(url,context);}});
