import { writeFileSync } from 'node:fs';
const result = { checkedAt: new Date().toISOString(), shellExecutable: '/bin/fish', invocation: 'Core exec_command shell=/bin/fish login=true; noninteractive',
  present: { AI_GATEWAY_API_KEY: typeof process.env.AI_GATEWAY_API_KEY === 'string' && process.env.AI_GATEWAY_API_KEY.length > 0,
    VERCEL_OIDC_TOKEN: typeof process.env.VERCEL_OIDC_TOKEN === 'string' && process.env.VERCEL_OIDC_TOKEN.length > 0 } };
writeFileSync(new URL('LOGIN_SHELL_ACCESS.json', import.meta.url), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ shellExecutable: result.shellExecutable, ...result.present }));
