// Visual tokens for every email. Email clients ignore CSS variables and most modern CSS, so values are
// plain hex and applied inline. Gradients get a solid fallback for Outlook.

export const brand = {
  name: 'Friday AI',
  tagline: 'Real-time AI interview assistant',
  company: 'BidYourStay',
};

export const color = {
  page: '#f2f4f8',
  card: '#ffffff',
  ink: '#0b1220',
  body: '#3b4659',
  muted: '#7a8599',
  faint: '#a3acbd',
  line: '#e6e9f0',
  brand: '#10b981',
  brandDark: '#047857',
  brandTint: '#ecfdf5',
  brandLine: '#a7f3d0',
  cyan: '#22d3ee',
  violet: '#a78bfa',
  dark: '#0b0f17',
  warnTint: '#fff7ed',
  warnLine: '#fed7aa',
  warnInk: '#9a3412',
};

export const font = {
  sans: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  mono: "'SF Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
};

export const gradient = `linear-gradient(120deg, ${color.brand} 0%, ${color.cyan} 55%, ${color.violet} 100%)`;
