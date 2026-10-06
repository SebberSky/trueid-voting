import { readFile, mkdir, writeFile } from 'node:fs/promises';
const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const source = await readFile(new URL('./server.mjs', import.meta.url), 'utf8');
const client = await readFile(new URL('./client.js', import.meta.url), 'utf8');
await mkdir(new URL('./dist/server/', import.meta.url), { recursive: true });
await writeFile(new URL('./dist/server/index.js', import.meta.url), `const HTML = ${JSON.stringify(html)};\nconst CLIENT = ${JSON.stringify(client)};\n${source}`);
