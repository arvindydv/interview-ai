import { PCM16_WORKLET } from '@/lib/pcm16Worklet';

// The practice room's microphone worklet (lib/practice.ts, useMicrophone), as a same-origin script.
export const dynamic = 'force-static';

export function GET() {
  return new Response(PCM16_WORKLET, {
    headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
}
