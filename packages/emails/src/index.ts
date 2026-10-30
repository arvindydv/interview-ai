import { createElement, type ReactElement } from 'react';
import { render } from 'react-email';
import { WelcomeEmail, type WelcomeEmailProps } from './templates/welcome.js';
import { NewDeviceEmail, type NewDeviceEmailProps } from './templates/new-device.js';
import { AutoApplyAttentionEmail, type AutoApplyAttentionEmailProps } from './templates/auto-apply-attention.js';
import { brand } from './theme.js';

export { brand } from './theme.js';
export * from './templates/auth.js';
export type { WelcomeEmailProps, NewDeviceEmailProps, AutoApplyAttentionEmailProps };

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

async function toEmail(subject: string, element: ReactElement): Promise<RenderedEmail> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text };
}

/** Product (non-auth) emails, sent by apps/worker. Add new ones here so the queue stays type-safe. */
export const emails = {
  welcome: (p: WelcomeEmailProps) => toEmail(`Welcome to ${brand.name}, ${p.name}`, createElement(WelcomeEmail, p)),
  newDevice: (p: NewDeviceEmailProps) =>
    toEmail(`New sign-in to ${brand.name} on ${p.osVersion || p.os}`, createElement(NewDeviceEmail, p)),
  autoApplyAttention: (p: AutoApplyAttentionEmailProps) =>
    toEmail('Some of your applications need you', createElement(AutoApplyAttentionEmail, p)),
};

export type EmailTemplate = keyof typeof emails;
export type EmailProps<T extends EmailTemplate> = Parameters<(typeof emails)[T]>[0];

/** Payload of a job on the `email` queue. */
export type EmailJob = {
  [T in EmailTemplate]: { template: T; to: string; props: EmailProps<T> };
}[EmailTemplate];
