import { cp, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

const SOURCE = path.join('src', 'app', 'templates');
const DESTINATION = path.join('dist', 'src', 'app', 'templates');

await mkdir(DESTINATION, { recursive: true });
await cp(SOURCE, DESTINATION, { recursive: true });

const copied = await readdir(DESTINATION);
console.log(`Copied ${copied.length} email template(s) to ${DESTINATION}`);
