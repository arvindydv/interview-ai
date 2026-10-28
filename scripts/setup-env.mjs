// Copies each app's .env.example to its local env file if it doesn't exist yet.
import { copyFileSync, existsSync } from 'node:fs';

const files = [
  ['apps/api/.env.example', 'apps/api/.env'],
  ['apps/worker/.env.example', 'apps/worker/.env'],
  ['apps/web/.env.example', 'apps/web/.env.local'],
  ['apps/admin/.env.example', 'apps/admin/.env.local'],
  ['apps/jobs/.env.example', 'apps/jobs/.env.local'],
  ['apps/desktop/.env.example', 'apps/desktop/.env'],
];
for (const [from, to] of files) {
  if (existsSync(to)) console.log(`kept    ${to}`);
  else {
    copyFileSync(from, to);
    console.log(`created ${to}`);
  }
}
