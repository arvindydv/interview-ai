import { ImageResponse } from 'next/og';

// Social card for links shared on LinkedIn, WhatsApp, X, Slack… Pages without their own image inherit it.
export const alt = 'Friday AI: the real-time AI interview assistant';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: '#05070c',
          backgroundImage:
            'radial-gradient(circle at 15% 10%, rgba(52,211,153,0.28), transparent 45%), radial-gradient(circle at 90% 20%, rgba(167,139,250,0.25), transparent 45%), radial-gradient(circle at 60% 100%, rgba(34,211,238,0.18), transparent 50%)',
          color: '#eef1f7',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <svg width="64" height="64" viewBox="0 0 32 32">
            <defs>
              <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#34d399" />
                <stop offset="0.55" stopColor="#22d3ee" />
                <stop offset="1" stopColor="#a78bfa" />
              </linearGradient>
            </defs>
            <path d="M9 1.5h14A7.5 7.5 0 0 1 30.5 9v11A7.5 7.5 0 0 1 23 27.5H13.5L7 31.5v-4.6A7.5 7.5 0 0 1 1.5 20V9A7.5 7.5 0 0 1 9 1.5z" fill="url(#g)" />
            <path d="M8 8.75A2.25 2.25 0 0 1 10.25 6.5h10a2.25 2.25 0 0 1 0 4.5H12.5v2.75H17a2.25 2.25 0 0 1 0 4.5h-4.5v2.5a2.25 2.25 0 0 1-4.5 0z" fill="#04120c" />
          </svg>
          <span style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>Friday AI</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 84, fontWeight: 700, lineHeight: 1.02, letterSpacing: -3 }}>Real-time AI</div>
          <div
            style={{
              fontSize: 84,
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: -3,
              backgroundImage: 'linear-gradient(100deg, #34d399, #22d3ee 50%, #a78bfa)',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            interview assistant
          </div>
          <div style={{ marginTop: 28, fontSize: 32, color: '#8a94a8', maxWidth: 900 }}>
            Tailored answers on a private overlay, in under a second. Zoom, Google Meet and Microsoft Teams.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 14, fontSize: 24, color: '#c3cad8' }}>
          {['Live answers', 'Coding solutions', 'AI mock interviews', 'Windows · macOS'].map((t) => (
            <div key={t} style={{ display: 'flex', padding: '10px 20px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.04)' }}>
              {t}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
