// How the practice interviewer addresses the candidate: by the name on their resume.

const NAME_WORD = /^[\p{L}][\p{L}'’.-]*$/u;

/** "ARVIND YADAV" → "Arvind Yadav"; names already in mixed case are left as written. */
function tidyName(name: string) {
  const words = name.trim().replace(/\s+/g, ' ').split(' ');
  if (!words.length || words.length > 5 || !words.every((w) => NAME_WORD.test(w))) return '';
  const shouting = name === name.toUpperCase() || name === name.toLowerCase();
  return shouting ? words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') : words.join(' ');
}

/**
 * The candidate's name as their resume gives it: from the analysed profile, or else the resume's first
 * line when it looks like a name (the analysis may still be running).
 */
export function resumeName(parsed: string | null, text: string) {
  if (parsed) {
    const n = tidyName(parsed);
    if (n) return n;
  }
  const first = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return first.length <= 60 ? tidyName(first.split(/[|,•·–—]/)[0]) : '';
}
