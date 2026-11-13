// Every variable apps/api/src/env.ts reads is documented: in apps/api/.env.example for local
// development, and for production in infra/secrets/api.env.example or set by deploy/compose.yml.
// A variable missing from the production template is how a server ends up running on a default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const schemaKeys = [...read('apps/api/src/env.ts').matchAll(/^  ([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]);
/** NAME=… lines, commented out or not. */
const documented = (text: string) => new Set([...text.matchAll(/^#?\s?([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
/** Keys deploy/compose.yml sets in a service's environment block, or mentions as set there. */
const compose = read('deploy/compose.yml');

test('env.ts has variables to check', () => assert.ok(schemaKeys.length > 10));

test('every variable is in the development example', () => {
  const dev = documented(read('apps/api/.env.example'));
  assert.deepEqual(schemaKeys.filter((k) => !dev.has(k)), []);
});

test('every variable is in the production template or set by deploy/compose.yml', () => {
  const prod = read('infra/secrets/api.env.example');
  const keys = documented(prod);
  const missing = schemaKeys.filter((k) => !keys.has(k) && !new RegExp(`\\b${k}\\b`).test(compose) && !new RegExp(`\\b${k}\\b.*deploy/compose\\.yml|deploy/compose\\.yml.*\\b${k}\\b`).test(prod));
  assert.deepEqual(missing, []);
});
