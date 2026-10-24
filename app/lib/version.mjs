import {readFile} from 'node:fs/promises';
export const version=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8')).version;
