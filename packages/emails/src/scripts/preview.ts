// Renders every email with sample data to packages/emails/preview/ for review in a browser.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { render } from 'react-email';
import { emails, supabaseTemplates } from '../index.js';

const out = join(dirname(fileURLToPath(import.meta.url)), '../../preview');
mkdirSync(out, { recursive: true });
const appUrl = 'http://localhost:3100';
const sample = {
  token: '483 920'.replace(' ', ''),
  confirmationUrl: `${appUrl}/auth/callback?code=sample`,
  siteUrl: appUrl,
  email: 'sourabh@example.com',
  newEmail: 'sourabh.new@example.com',
};

const pages: [string, string, string][] = [];
for (const [key, { component, subject }] of Object.entries(supabaseTemplates)) {
  writeFileSync(join(out, `auth-${key}.html`), await render(createElement(component, sample)));
  pages.push([`auth-${key}.html`, subject, 'Supabase Auth']);
}
const welcome = await emails.welcome({ name: 'Sourabh', email: sample.email, appUrl });
const device = await emails.newDevice({
  email: sample.email,
  appUrl,
  os: 'macos',
  osVersion: 'macOS 15.1',
  appVersion: '0.1.0',
  when: '15 Oct 2026, 22:41 UTC',
});
for (const [name, e] of [['welcome', welcome], ['new-device', device]] as const) {
  writeFileSync(join(out, `${name}.html`), e.html);
  writeFileSync(join(out, `${name}.txt`), e.text);
  pages.push([`${name}.html`, e.subject, 'Worker']);
}
writeFileSync(
  join(out, 'index.html'),
  `<!doctype html><meta charset=utf-8><title>Email previews</title><body style="font-family:system-ui;padding:32px">
<h1>Email previews</h1><ul>${pages.map(([f, s, k]) => `<li><a href="${f}">${s}</a> <small>(${k})</small></li>`).join('')}</ul>`,
);
console.log(`previews in ${out}/index.html`);
