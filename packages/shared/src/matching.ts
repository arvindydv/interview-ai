// Friday Jobs matching: what a job description requires (extractRequirements) and how well a candidate's
// verified profile meets it (scoreMatch), as a 0–100 score with an explanation. Deterministic and cheap,
// so every user's matches are recomputed after each listings sync without model calls.
//
// Truth rules: the candidate's skills are only the ones on their own resume (parsed_json.skills) and
// their work authorization only what they said in the Application Profile. Unknown is never treated as
// yes or no: it shows as a gap, never as a match or a rejection.
//
// Eligibility: a job is ineligible (kept for the explanation, never auto-applied to) when a mandatory
// requirement fails: work authorization the candidate said they don't hold (and no sponsorship), a job
// outside India with no remote option for a candidate authorized only in India, far more experience than
// they have (config.maxExperienceGapYears), an employment type they excluded, a salary range entirely
// below their minimum, or a posting older than config.maxPostedDays (stale postings are mostly filled).

import type { WorkAuthorization } from './autoApply.js';
import { DEFAULT_MATCH_CONFIG, type JobRequirements, type MatchConfig, type MatchExplanation, type MatchWeights } from './applyPipeline.js';
import type { Workplace } from './listings.js';

/** Bump when extraction changes: cached job_requirements rows of an older version are re-parsed. */
export const REQUIREMENTS_VERSION = 1;

/** Conversion to rupees used for salary checks (fixed so scores are stable; reviewed 2026-11). */
export const INR_PER = { INR: 1, USD: 85, EUR: 92, GBP: 108, SGD: 64, AUD: 56, CAD: 62, AED: 23 } as const;

// ---- Skills lexicon --------------------------------------------------------------------------------

/** Canonical name → other ways postings write it. Requirements are read only against this list. */
const LEXICON: Record<string, string[]> = {
  JavaScript: ['javascript', 'js', 'es6', 'ecmascript'], TypeScript: ['typescript', 'ts'], Python: ['python'], Java: ['java'],
  Go: ['golang', 'go lang'], Rust: ['rust'], 'C++': ['c++', 'cpp'], 'C#': ['c#', 'csharp'], C: [], Kotlin: ['kotlin'], Swift: ['swift'],
  'Objective-C': ['objective-c', 'objective c', 'objc'], Scala: ['scala'], Ruby: ['ruby'], PHP: ['php'], R: [], Dart: ['dart'],
  Elixir: ['elixir'], Haskell: ['haskell'], Perl: ['perl'], Bash: ['bash', 'shell scripting'], SQL: ['sql'], 'PL/SQL': ['pl/sql', 'plsql'],
  React: ['react', 'react.js', 'reactjs'], 'React Native': ['react native'], 'Next.js': ['next.js', 'nextjs'], Angular: ['angular', 'angularjs'],
  'Vue.js': ['vue', 'vue.js', 'vuejs'], Svelte: ['svelte'], Redux: ['redux'], HTML: ['html', 'html5'], CSS: ['css', 'css3'],
  'Tailwind CSS': ['tailwind', 'tailwindcss'], 'Node.js': ['node.js', 'nodejs', 'node js'], Express: ['express', 'express.js', 'expressjs'],
  NestJS: ['nestjs', 'nest.js'], Django: ['django'], Flask: ['flask'], FastAPI: ['fastapi'], 'Spring Boot': ['spring boot', 'springboot'],
  Spring: ['spring framework', 'spring mvc'], Hibernate: ['hibernate'], 'Ruby on Rails': ['rails', 'ruby on rails'], Laravel: ['laravel'],
  '.NET': ['.net', 'dotnet', 'asp.net', '.net core'], GraphQL: ['graphql'], REST: ['restful', 'rest api', 'rest apis', 'rest services'],
  gRPC: ['grpc'], Microservices: ['microservices', 'micro-services', 'microservice'], PostgreSQL: ['postgres', 'postgresql'],
  MySQL: ['mysql'], MongoDB: ['mongodb', 'mongo'], Redis: ['redis'], Elasticsearch: ['elasticsearch', 'elastic search', 'opensearch'],
  Cassandra: ['cassandra'], DynamoDB: ['dynamodb'], Oracle: ['oracle db', 'oracle database'], 'SQL Server': ['sql server', 'mssql'],
  Snowflake: ['snowflake'], BigQuery: ['bigquery'], Redshift: ['redshift'], Databricks: ['databricks'], Kafka: ['kafka', 'apache kafka'],
  RabbitMQ: ['rabbitmq'], Spark: ['spark', 'pyspark', 'apache spark'], Hadoop: ['hadoop'], Airflow: ['airflow', 'apache airflow'],
  dbt: ['dbt'], Flink: ['flink'], AWS: ['aws', 'amazon web services'], GCP: ['gcp', 'google cloud', 'google cloud platform'],
  Azure: ['azure', 'microsoft azure'], Docker: ['docker'], Kubernetes: ['kubernetes', 'k8s'], Terraform: ['terraform'],
  Ansible: ['ansible'], Jenkins: ['jenkins'], 'GitHub Actions': ['github actions'], 'CI/CD': ['ci/cd', 'ci cd', 'continuous integration'],
  Linux: ['linux', 'unix'], Git: ['git'], Prometheus: ['prometheus'], Grafana: ['grafana'], Datadog: ['datadog'], Helm: ['helm'],
  Nginx: ['nginx'], 'Machine Learning': ['machine learning', 'ml'], 'Deep Learning': ['deep learning'], NLP: ['nlp', 'natural language processing'],
  'Computer Vision': ['computer vision'], LLM: ['llm', 'llms', 'large language models', 'large language model'], 'Generative AI': ['generative ai', 'genai', 'gen ai'],
  PyTorch: ['pytorch'], TensorFlow: ['tensorflow'], 'scikit-learn': ['scikit-learn', 'sklearn'], Pandas: ['pandas'], NumPy: ['numpy'],
  LangChain: ['langchain'], MLOps: ['mlops'], Tableau: ['tableau'], 'Power BI': ['power bi', 'powerbi'], Looker: ['looker'],
  Excel: ['excel', 'ms excel', 'microsoft excel'], Statistics: ['statistics', 'statistical analysis'], 'A/B Testing': ['a/b testing', 'ab testing', 'experimentation'],
  Android: ['android'], iOS: ['ios'], Flutter: ['flutter'], SwiftUI: ['swiftui'], Jetpack: ['jetpack compose'], macOS: ['macos', 'mac os'],
  Selenium: ['selenium'], Cypress: ['cypress'], Playwright: ['playwright'], Jest: ['jest'], JUnit: ['junit'], Appium: ['appium'],
  'Test Automation': ['test automation', 'automation testing'], Figma: ['figma'], 'UI/UX': ['ui/ux', 'ux design', 'ui design'],
  'System Design': ['system design', 'distributed systems'], 'Data Structures': ['data structures', 'algorithms', 'dsa'],
  Security: ['application security', 'appsec', 'cybersecurity', 'information security'], SIEM: ['siem'], 'Penetration Testing': ['penetration testing', 'pentesting'],
  Salesforce: ['salesforce'], SAP: ['sap'], ServiceNow: ['servicenow'], Jira: ['jira'], Agile: ['agile', 'scrum'], Blockchain: ['blockchain', 'web3'],
  Solidity: ['solidity'], Unity: ['unity3d', 'unity engine'], 'Unreal Engine': ['unreal', 'unreal engine'], Embedded: ['embedded systems', 'embedded c', 'firmware'],
  RTOS: ['rtos'], Verilog: ['verilog', 'systemverilog'], Networking: ['tcp/ip', 'networking protocols'], ETL: ['etl', 'elt', 'data pipelines'],
  'Data Modeling': ['data modeling', 'data modelling'], Webpack: ['webpack'], Vite: ['vite'],
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const boundary = (alts: string[]) => new RegExp(`(?:^|[^a-z0-9+#.])(?:${alts.map(escapeRe).join('|')})(?![a-z0-9+#]|\\.[a-z0-9])`, 'i');

/** Ways a candidate's own skill name is written ("React.js" also as "React" and "ReactJS"). */
function variants(skill: string): string[] {
  const s = skill.toLowerCase().trim();
  const parts = s.includes('/') ? s.split('/').map((p) => p.trim()) : [];
  // One-letter names ("C", "R") and "Go" match too much ordinary text.
  return [...new Set([s, s.replace(/\.js$/, ''), s.replace(/\.js$/, 'js'), ...parts])].filter((v) => v.length > 2 || /[+#]/.test(v));
}

/** Canonical names that are ordinary words or company names: matched only through their aliases. */
const ALIAS_ONLY = new Set(['Security', 'Networking', 'Embedded', 'Unity', 'Oracle', 'Jetpack', 'Spring']);

const LEXICON_RES = Object.entries(LEXICON)
  .map(([name, aliases]) => {
    const alts = [...new Set([...(ALIAS_ONLY.has(name) ? [] : [name.toLowerCase()]), ...aliases])].filter((v) => v.length > 2 || /[+#]/.test(v) || aliases.includes(v));
    // Short bare words that are also English ("go", "r", "c", "rest", "spring", "swift", "express", "rust", "node", "unity")
    // only count when the alias list spells them out explicitly.
    return { name, re: alts.length ? boundary(alts) : null };
  })
  .filter((x): x is { name: string; re: RegExp } => x.re !== null);

/** Common English words that are also skill aliases: only counted in a list-like context. */
const AMBIGUOUS = new Set(['Helm', 'Spring', 'Swift', 'Express', 'Rust', 'Go', 'Excel', 'Security', 'Agile', 'Statistics', 'Networking', 'Embedded']);

/** Lexicon skills named in a text, canonical names. */
export function lexiconSkills(text: string): string[] {
  const t = ` ${text.toLowerCase()} `;
  return LEXICON_RES.filter((s) => s.re.test(t)).map((s) => s.name);
}

/** Lowercased canonical key for a skill name, so "ReactJS" on a resume equals "React" in a posting. */
export function skillKey(skill: string): string {
  const s = skill.toLowerCase().trim();
  for (const [name, aliases] of Object.entries(LEXICON)) {
    if (name.toLowerCase() === s || aliases.includes(s)) return name.toLowerCase();
  }
  return s.replace(/\.js$/, '').replace(/js$/, '');
}

/** The candidate's own skills that a text mentions (their spelling). */
export function candidateSkillsIn(skills: string[], text: string): string[] {
  const t = ` ${text.toLowerCase()} `;
  return skills.filter((s) => {
    const v = variants(s);
    return v.length > 0 && boundary(v).test(t);
  });
}

// ---- Requirements ---------------------------------------------------------------------------------

const MANDATORY_HEAD = /\b(requirements?|qualifications?|must[- ]haves?|what you('ll)? (need|bring)|what we('re| are) looking for|you (have|bring|should have|will need)|who you are|about you|minimum|basic qualifications|required|skills|experience required|your profile|what you will bring|eligibility)\b/i;
const PREFERRED_HEAD = /\b(nice[- ]to[- ]haves?|preferred|bonus|desirable|good[- ]to[- ]haves?|plus(es)?|ideally|extra credit|added advantage|great if you)\b/i;
const NEUTRAL_HEAD = /\b(responsibilities|what you('ll)? do|about (us|the (company|team|role))|benefits|perks|why join|what we offer|the role|your role|day to day|our (team|mission|culture)|equal opportunity|how to apply|compensation)\b/i;
const PREFERRED_LINE = /\b(nice[- ]to[- ]have|preferred|is a plus|a plus|bonus|good[- ]to[- ]have|desirable|advantage|advantageous|ideally|familiarity with|exposure to)\b/i;
const MANDATORY_LINE = /\b(must|required|mandatory|requires?|need to have|strong (experience|knowledge|proficiency)|proficien(t|cy) in|hands[- ]on experience|expert(ise)? in|solid (experience|understanding)|minimum|at least|\d+\s*\+?\s*(years?|yrs))\b/i;

/** A short line that names a section rather than saying something. */
const isHeading = (line: string) => line.length <= 80 && !/[.;]$/.test(line.trim()) && line.split(/\s+/).length <= 10;

function lines(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9•\-*])|\s[•·▪●]\s/)
    .map((l) => l.replace(/^[\s•·▪●*\-–]+/, '').trim())
    .filter(Boolean);
}

/** Years of experience asked for: [min, max], from the requirement lines (never "preferred" ones). */
export function parseYears(text: string): [number | null, number | null] {
  let min: number | null = null;
  let max: number | null = null;
  for (const line of lines(text)) {
    if (PREFERRED_LINE.test(line)) continue;
    const l = line.toLowerCase();
    if (!/experience|exp\b|years? (in|of|with|working)|yrs/.test(l)) continue;
    const range = /(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:-|–|—|to)\s*(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)/.exec(l);
    const plus = /(\d{1,2}(?:\.\d)?)\s*(?:\+|plus)\s*(?:years?|yrs?)/.exec(l);
    const least = /(?:minimum|at least|min\.?|over|more than)\s*(?:of\s*)?(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)/.exec(l);
    const bare = /(\d{1,2}(?:\.\d)?)\s*(?:years?|yrs?)(?:\s+of)?(?:\s+[\w/+#.-]+){0,5}?\s+(?:experience|exp\b)/.exec(l);
    let lo: number | null = null;
    let hi: number | null = null;
    if (range) [lo, hi] = [Number(range[1]), Number(range[2])];
    else if (plus) lo = Number(plus[1]);
    else if (least) lo = Number(least[1]);
    else if (bare) lo = Number(bare[1]);
    if (lo === null || lo > 25 || (hi !== null && (hi > 30 || hi < lo))) continue;
    // Several mentions ("5+ years overall, 2+ with Kafka"): the overall bar is the highest minimum.
    if (min === null || lo > min) {
      min = lo;
      max = hi;
    }
  }
  return [min, max];
}

function currencyOf(t: string): keyof typeof INR_PER | null {
  if (/₹|\binr\b|\brs\.?\s|\blpa\b|\blakhs?\b|\blacs?\b|\bcrores?\b/.test(t)) return 'INR';
  if (/\bsgd\b|s\$/.test(t)) return 'SGD';
  if (/\baud\b|a\$/.test(t)) return 'AUD';
  if (/\bcad\b|c\$/.test(t)) return 'CAD';
  if (/\baed\b/.test(t)) return 'AED';
  if (/\$|\busd\b/.test(t)) return 'USD';
  if (/€|\beur\b/.test(t)) return 'EUR';
  if (/£|\bgbp\b/.test(t)) return 'GBP';
  return null;
}

/** A salary text as lakhs a year (INR): [min, max]. Null when it gives no amount with a currency. */
export function parseSalaryLpa(text: string | null | undefined): [number | null, number | null] {
  if (!text) return [null, null];
  const t = text.toLowerCase().replace(/(\d),(?=\d)/g, '$1');
  const lakh = /(\d+(?:\.\d+)?)\s*(?:(?:-|–|—|to)\s*(\d+(?:\.\d+)?)\s*)?(lpa|lakhs?|lacs?|l\b|crores?|cr\b)/.exec(t);
  if (lakh) {
    const k = /^cr/.test(lakh[3]) ? 100 : 1;
    const lo = Number(lakh[1]) * k;
    const hi = lakh[2] ? Number(lakh[2]) * k : lo;
    return lo > 0 && lo <= 2000 ? [lo, Math.max(lo, hi)] : [null, null];
  }
  const cur = currencyOf(t);
  if (!cur) return [null, null];
  const amounts = [...t.matchAll(/(\d+(?:\.\d+)?)\s*(k|m|mn|million)?\b/g)]
    .map((m) => Number(m[1]) * (m[2] === 'k' ? 1e3 : m[2] ? 1e6 : 1))
    .filter((n) => n >= 10);
  if (!amounts.length) return [null, null];
  const per = /hour|hourly|\/\s*hr\b|per hr/.test(t) ? 2080 : /month|monthly|\/\s*mo\b|p\.m\./.test(t) ? 12 : 1;
  const yearly = amounts.slice(0, 2).map((n) => n * per * INR_PER[cur]);
  const lpa = yearly.map((n) => Math.round((n / 1e5) * 10) / 10);
  const [lo, hi] = [Math.min(...lpa), Math.max(...lpa)];
  // Below ₹1 LPA a year is not a salary (a stipend per day, a typo, a number that wasn't one).
  return lo >= 1 ? [lo, hi] : [null, null];
}

export function parseEmploymentType(typeText: string | null | undefined, title: string, description = ''): JobRequirements['employmentType'] {
  const t = (typeText ?? '').toLowerCase();
  if (t) {
    if (/intern/.test(t)) return 'internship';
    if (/contract|freelance|consultant/.test(t)) return 'contract';
    if (/part[\s-]?time/.test(t)) return 'part_time';
    if (/temporary|\btemp\b|fixed[\s-]?term|seasonal/.test(t)) return 'temporary';
    if (/full|permanent|regular|employee|on[\s-]?roll/.test(t)) return 'full_time';
  }
  const tt = title.toLowerCase();
  if (/\b(intern|internship)\b/.test(tt)) return 'internship';
  if (/\b(contract|contractor|freelance|c2h)\b/.test(tt)) return 'contract';
  if (/\bpart[\s-]?time\b/.test(tt)) return 'part_time';
  const d = description.toLowerCase();
  if (/\b(this is an? |a )(\d+[- ]months? )?(contract|contractual) (role|position|engagement)|contract[- ]to[- ]hire\b/.test(d)) return 'contract';
  if (/\b(this is an? |an? )internship\b/.test(d)) return 'internship';
  return null;
}

const COUNTRY: [RegExp, string][] = [
  [/^(the )?(u\.?s\.?a?\.?|united states( of america)?|america)$/, 'United States'],
  [/^(the )?(u\.?k\.?|united kingdom|great britain|britain|england)$/, 'United Kingdom'],
  [/^canada$/, 'Canada'], [/^india$/, 'India'], [/^germany$/, 'Germany'], [/^(the )?netherlands$/, 'Netherlands'],
  [/^ireland$/, 'Ireland'], [/^australia$/, 'Australia'], [/^singapore$/, 'Singapore'], [/^france$/, 'France'],
  [/^spain$/, 'Spain'], [/^poland$/, 'Poland'], [/^japan$/, 'Japan'], [/^(the )?(eu|european union)$/, 'European Union'],
  [/^(the )?(uae|united arab emirates)$/, 'United Arab Emirates'], [/^israel$/, 'Israel'], [/^brazil$/, 'Brazil'], [/^mexico$/, 'Mexico'],
];
const countryOf = (raw: string) => {
  const s = raw.toLowerCase().replace(/[^a-z. ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return COUNTRY.find(([re]) => re.test(s))?.[1] ?? null;
};

export function parseWorkAuth(text: string): Pick<JobRequirements, 'workAuthCountries' | 'sponsorship'> {
  const countries = new Set<string>();
  const authRe = /(?:authori[sz]ed|eligible|legally (?:able|permitted|allowed)|permitted|right|permission) to (?:live and )?work (?:in|within|for an employer in) (?:the )?([a-z][a-z .]{1,30}?)(?=[,.;:)(]|\s+(?:without|and|or|for|at|on|is|are|by|now|as|with|on a)\b|$)/gi;
  for (const m of text.matchAll(authRe)) {
    const c = countryOf(m[1]);
    if (c) countries.add(c);
  }
  for (const m of text.matchAll(/\b(u\.?s\.?|us|united states|uk|canadian|australian|indian) citizen(?:ship)?\b/gi)) {
    const c = countryOf(m[1].replace(/canadian/i, 'canada').replace(/australian/i, 'australia').replace(/indian/i, 'india'));
    if (c) countries.add(c);
  }
  const t = text.toLowerCase();
  const notOffered =
    /\b(no|not|unable to|cannot|can't|won't|will not|do not|does not|don't|doesn't|are not able to)\b[^.]{0,40}\bsponsor/.test(t) ||
    /sponsorship (is )?(not|un)available|without (the need for |requiring )?(current or future )?(visa |employment )?sponsorship|not eligible for (visa )?sponsorship/.test(t);
  const offered = !notOffered && /(visa )?sponsorship (is )?(available|provided|offered)|\bwe (will |can |do )?sponsor\b|visa support|relocation and visa/.test(t);
  return { workAuthCountries: [...countries], sponsorship: notOffered ? 'not_offered' : offered ? 'offered' : 'unknown' };
}

const DEGREE_RANK: [RegExp, string, number][] = [
  [/\b(ph\.?\s?d|doctorate|doctoral)\b/i, 'PhD', 3],
  [/\b(master'?s|m\.?\s?tech|m\.?\s?s\.?(?= in| degree)|msc|m\.sc|mba|m\.?\s?e\.?(?= in)|mca|post[- ]?graduate)\b/i, "Master's", 2],
  [/\b(bachelor'?s|b\.?\s?tech|b\.?\s?e\.?(?= in| degree)|b\.?\s?s\.?(?= in| degree)|bsc|b\.sc|bca|undergraduate degree|graduate degree|degree in (computer science|engineering|it|information technology))\b/i, "Bachelor's", 1],
];

export function parseDegree(text: string): string | null {
  for (const line of lines(text)) {
    if (PREFERRED_LINE.test(line) || !/degree|bachelor|master|ph\.?d|b\.?tech|m\.?tech|graduate|mba|bsc|msc|mca|bca/i.test(line)) continue;
    // "Bachelor's or Master's": the lowest one named is what's required.
    const found = DEGREE_RANK.filter(([re]) => re.test(line)).sort((a, b) => a[2] - b[2]);
    if (found.length) return found[0][1];
  }
  return null;
}

/** What a job description requires. */
export function extractRequirements(
  title: string,
  descriptionText: string,
  salaryText: string | null,
  employmentTypeText: string | null,
  workplace: Workplace | null,
  _location = '',
): JobRequirements {
  const mandatory = new Set<string>(lexiconSkills(title).filter((s) => !AMBIGUOUS.has(s)));
  const preferred = new Set<string>();
  const neutral = new Set<string>();
  let section: 'mandatory' | 'preferred' | 'neutral' | null = null;
  for (const line of lines(descriptionText)) {
    const found = lexiconSkills(line).filter((s) => !AMBIGUOUS.has(s) || /,|\/|\(|:/.test(line));
    // A heading starts a section ("Requirements", "Nice to have"); a short line naming skills is a bullet.
    if (isHeading(line) && !found.length) {
      // A heading can name both ("Required and preferred skills"); preferred wins only when it leads.
      if (PREFERRED_HEAD.test(line) && !/^(required|must|minimum|basic)/i.test(line)) section = 'preferred';
      else if (NEUTRAL_HEAD.test(line)) section = 'neutral';
      else if (MANDATORY_HEAD.test(line)) section = 'mandatory';
      continue;
    }
    if (!found.length) continue;
    const bucket = PREFERRED_LINE.test(line) ? preferred : MANDATORY_LINE.test(line) || section === 'mandatory' ? mandatory : section === 'preferred' ? preferred : neutral;
    for (const s of found) bucket.add(s);
  }
  // Without a requirements section, skills the posting names elsewhere are what it's about: preferred.
  for (const s of neutral) if (!mandatory.has(s)) preferred.add(s);
  for (const s of mandatory) preferred.delete(s);

  const [minYears, maxYears] = parseYears(descriptionText);
  const fromField = parseSalaryLpa(salaryText);
  const salaryLine = fromField[0] !== null
    ? null
    : lines(descriptionText).find((l) => /salary|compensation|ctc|pay range|base pay|package|stipend|lpa/i.test(l) && currencyOf(l.toLowerCase()) !== null) ?? null;
  const [salaryMinLpa, salaryMaxLpa] = fromField[0] !== null ? fromField : parseSalaryLpa(salaryLine);
  return {
    mandatorySkills: [...mandatory].slice(0, 25),
    preferredSkills: [...preferred].slice(0, 25),
    minYears,
    maxYears,
    salaryMinLpa,
    salaryMaxLpa,
    employmentType: parseEmploymentType(employmentTypeText, title, descriptionText),
    workplace,
    ...parseWorkAuth(descriptionText),
    degreeRequired: parseDegree(descriptionText),
  };
}

// ---- Scoring --------------------------------------------------------------------------------------

// Words that say nothing about the kind of job, or only its level (scored separately).
const TITLE_NOISE = new Set(
  'a an and at for in of on the to with i ii iii iv v senior sr junior jr staff principal lead associate intern internship trainee new grad graduate entry level mid remote hybrid onsite india us usa uk emea apac contract full time part'.split(' '),
);

/** Lowercased title words, with common spelling variants folded together. */
export function titleTokens(title: string): string[] {
  const t = title
    .toLowerCase()
    .replace(/\b(front|back)[\s-]+end\b/g, '$1end')
    .replace(/\bfull[\s-]+stack\b/g, 'fullstack')
    .replace(/\b(sde|swe)\b/g, 'software engineer')
    .replace(/\bdev(eloper)?s?\b/g, 'engineer')
    .replace(/\bengineers\b/g, 'engineer')
    .replace(/\bml\b/g, 'machine learning');
  return [...new Set(t.split(/[^a-z0-9+#]+/).filter((w) => w && !TITLE_NOISE.has(w)))];
}

/** 1 when the listing title is the same kind of job as one of the roles; the role's last word weighs most. */
export function titleFit(roles: string[], listingTitle: string): number {
  const listing = new Set(titleTokens(listingTitle));
  let best = 0;
  for (const role of roles) {
    const tokens = titleTokens(role);
    if (!tokens.length) continue;
    const head = tokens[tokens.length - 1];
    const rest = tokens.slice(0, -1);
    const restFit = rest.length ? rest.filter((w) => listing.has(w)).length / rest.length : 1;
    best = Math.max(best, listing.has(head) ? 0.6 + 0.4 * restFit : 0.25 * restFit);
  }
  return best;
}

/** Levels (job_listings.level: 0 intern … 5 director) that fit this much experience. */
export function levelFit(years: number | null, level: number): number {
  if (years === null) return 0.7;
  const [lo, hi] = years < 1 ? [0, 1] : years < 3 ? [1, 2] : years < 6 ? [2, 3] : years < 10 ? [3, 4] : [4, 5];
  if (level >= lo && level <= hi) return 1;
  return level === lo - 1 || level === hi + 1 ? 0.5 : 0;
}

/** The candidate, from their verified resume and Application Profile only. */
export interface MatchCandidateProfile {
  roles: string[];
  /** Skills on their own resume, most relevant first. */
  skills: string[];
  years: number | null;
  /** Preferred cities ("Bengaluru"); empty: anywhere. */
  locations: string[];
  /** Accepted arrangements; empty: any. */
  workplaces: Workplace[];
  workAuthorization: WorkAuthorization[];
  otherCountries: { authorized: boolean; needsSponsorship: boolean } | null;
  /** Where they live; '' is taken as India (Friday Jobs' market). */
  country: string;
  /** Degrees on their resume, as written ("B.Tech in CSE"). */
  degrees?: string[];
}

export interface MatchListingMeta {
  title: string;
  description?: string;
  level: number;
  location: string;
  workplace: Workplace | null;
  postedAt: Date | string | null;
  /** job_listings.eligibility (relative to India). */
  eligibility?: string | null;
  now?: Date;
}

const pct = (n: number) => Math.max(0, Math.min(100, Math.round(n * 100)));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Whether the candidate can work in a country: true, false, or null when they haven't said. */
function authorizedIn(c: MatchCandidateProfile, country: string): { authorized: boolean | null; needsSponsorship: boolean | null } {
  const entry = c.workAuthorization.find((w) => norm(w.country) === norm(country) || countryOf(w.country) === country);
  if (entry) return { authorized: entry.authorized, needsSponsorship: entry.needsSponsorship };
  if (c.otherCountries) return c.otherCountries;
  // Living in a country is not proof of the right to work there, but for India (the market) the
  // profile's country plus no entry at all is the common case: still unknown, never assumed.
  return { authorized: null, needsSponsorship: null };
}

function degreeRank(s: string): number {
  return DEGREE_RANK.find(([re]) => re.test(s))?.[2] ?? 0;
}

function recencyFit(postedAt: Date | string | null, now: Date): { fit: number; days: number | null } {
  if (!postedAt) return { fit: 0.6, days: null };
  const days = Math.max(0, (now.getTime() - new Date(postedAt).getTime()) / 86_400_000);
  const fit = days <= 3 ? 1 : days <= 7 ? 0.85 : days <= 14 ? 0.65 : days <= 30 ? 0.4 : 0.1;
  return { fit, days };
}

/** Merges a stored (possibly partial or out-of-range) config over the defaults. */
export function resolveMatchConfig(raw: unknown): MatchConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<MatchConfig>;
  const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  const d = DEFAULT_MATCH_CONFIG;
  const w = (r.weights ?? {}) as Partial<MatchWeights>;
  const weights = Object.fromEntries(
    (Object.keys(d.weights) as (keyof MatchWeights)[]).map((k) => [k, clamp(w[k], 0, 1, d.weights[k])]),
  ) as unknown as MatchWeights;
  return {
    strongMatch: clamp(r.strongMatch, 50, 100, d.strongMatch),
    minScore: clamp(r.minScore, 0, 90, d.minScore),
    weights: Object.values(weights).some((v) => v > 0) ? weights : d.weights,
    minSalaryLpa: r.minSalaryLpa === null || r.minSalaryLpa === undefined ? null : clamp(r.minSalaryLpa, 0, 1000, 0) || null,
    employmentTypes: Array.isArray(r.employmentTypes)
      ? r.employmentTypes.filter((t) => ['full_time', 'part_time', 'contract', 'internship', 'temporary'].includes(t))
      : d.employmentTypes,
    maxExperienceGapYears: clamp(r.maxExperienceGapYears, 0, 20, d.maxExperienceGapYears),
    maxPostedDays: clamp(r.maxPostedDays, 1, 365, d.maxPostedDays),
  };
}

const EMPLOYMENT_LABEL: Record<NonNullable<JobRequirements['employmentType']>, string> = {
  full_time: 'full-time', part_time: 'part-time', contract: 'contract', internship: 'internship', temporary: 'temporary',
};

/** How well the candidate fits the job, 0–100, and why. */
export function scoreMatch(
  c: MatchCandidateProfile,
  req: JobRequirements,
  listing: MatchListingMeta,
  config: MatchConfig = DEFAULT_MATCH_CONFIG,
): MatchExplanation {
  const reasons: string[] = [];
  const gaps: string[] = [];
  const rejections: string[] = [];
  const reject = (msg: string) => {
    rejections.push(msg);
    gaps.push(msg);
  };

  // Title.
  const title = c.roles.length ? titleFit(c.roles, listing.title) : 0.5;
  if (title >= 0.8) reasons.push(`The title fits the roles you're after.`);
  else if (title < 0.3) gaps.push('A different kind of role from the ones you’re after.');

  // Skills: requirement coverage when the posting lists any, else how many of the candidate's skills it names.
  // The candidate's own skills, plus the lexicon names inside them ("GitLab CI/CD" is also CI/CD).
  const have = new Set(c.skills.flatMap((s) => [skillKey(s), ...lexiconSkills(s).map((x) => x.toLowerCase())]));
  const mandatoryMatched = req.mandatorySkills.filter((s) => have.has(skillKey(s)));
  const mandatoryMissing = req.mandatorySkills.filter((s) => !have.has(skillKey(s)));
  const preferredMatched = req.preferredSkills.filter((s) => have.has(skillKey(s)));
  const inText = listing.description !== undefined ? candidateSkillsIn(c.skills.slice(0, 30), `${listing.title}\n${listing.description}`) : [];
  const textFit = Math.min(1, inText.length / Math.max(1, Math.min(8, c.skills.length)));
  let skills: number;
  if (req.mandatorySkills.length || req.preferredSkills.length) {
    const m = req.mandatorySkills.length ? mandatoryMatched.length / req.mandatorySkills.length : null;
    const p = req.preferredSkills.length ? preferredMatched.length / req.preferredSkills.length : null;
    const cover = m !== null && p !== null ? 0.75 * m + 0.25 * p : (m ?? p ?? 0);
    // Requirement coverage leads; the candidate's other skills the posting names still count a little.
    skills = 0.7 * cover + 0.3 * textFit;
  } else {
    skills = textFit;
  }
  if (mandatoryMatched.length) reasons.push(`You have ${mandatoryMatched.length} of ${req.mandatorySkills.length} required skills: ${mandatoryMatched.slice(0, 5).join(', ')}.`);
  else if (inText.length) reasons.push(`It asks for skills on your resume: ${inText.slice(0, 5).join(', ')}.`);
  if (mandatoryMissing.length) gaps.push(`Not on your resume: ${mandatoryMissing.slice(0, 5).join(', ')}${mandatoryMissing.length > 5 ? ` and ${mandatoryMissing.length - 5} more` : ''}.`);
  if (preferredMatched.length) reasons.push(`Nice-to-haves you have: ${preferredMatched.slice(0, 4).join(', ')}.`);

  // Experience.
  const level = levelFit(c.years, listing.level);
  let experience = level;
  if (req.minYears !== null && c.years !== null) {
    const gap = req.minYears - c.years;
    let years: number;
    if (gap > config.maxExperienceGapYears) {
      reject(`Asks for ${req.minYears}+ years; you have ${c.years}.`);
      years = 0;
    } else if (gap > 0) {
      years = Math.max(0, 1 - gap * 0.25);
      gaps.push(`Asks for ${req.minYears}+ years; you have ${c.years}.`);
    } else {
      years = req.maxYears !== null && c.years > req.maxYears + 4 ? 0.6 : 1;
      if (req.minYears > 0) reasons.push(`Your ${c.years} years meet the ${req.minYears}+ asked for.`);
    }
    // The title's seniority still counts: a junior title for someone with 8 years is a weaker fit.
    experience = gap > config.maxExperienceGapYears ? 0 : 0.6 * years + 0.4 * level;
    if (level === 0 && gap <= 0) gaps.push('The title’s seniority is well below your experience.');
  } else if (req.minYears !== null) {
    gaps.push(`Asks for ${req.minYears}+ years; your resume doesn’t say how many you have.`);
  }

  // Location and work authorization.
  const elig = listing.eligibility ?? null;
  const remoteOk = !c.workplaces.length || c.workplaces.includes('remote');
  const loc = norm(listing.location);
  const cityHit = c.locations.some((l) => norm(l) && loc.includes(norm(l)));
  let location = 0.6;
  if (elig === 'remote_india' || elig === 'remote_global') location = remoteOk ? 1 : 0.6;
  else if (elig === 'india') location = cityHit || !c.locations.length ? 1 : 0.6;
  else if (elig === 'remote_apac' || elig === 'remote_unspecified') location = remoteOk ? 0.7 : 0.4;
  else if (elig === 'remote_other' || elig === 'elsewhere') location = 0.2;
  if (cityHit) reasons.push(`In ${c.locations.find((l) => loc.includes(norm(l)))}.`);
  if (listing.workplace && c.workplaces.length && !c.workplaces.includes(listing.workplace)) {
    location = Math.min(location, 0.3);
    gaps.push(`It's ${listing.workplace}; you chose ${c.workplaces.join(' or ')}.`);
  }

  for (const country of req.workAuthCountries) {
    const a = authorizedIn(c, country);
    if (a.authorized === false && req.sponsorship !== 'offered') reject(`Needs authorization to work in ${country}, which you don’t have.`);
    else if (a.authorized === true && a.needsSponsorship && req.sponsorship === 'not_offered') reject(`You need sponsorship for ${country}; it isn’t offered.`);
    else if (a.authorized === null) gaps.push(`Needs authorization to work in ${country}; your profile doesn’t say.`);
    else if (a.authorized) reasons.push(`You can work in ${country}.`);
  }
  if (!req.workAuthCountries.length && (elig === 'elsewhere' || elig === 'remote_other')) {
    // Outside India with no remote option (or remote only in other countries): the candidate's say-so
    // about working outside their own country decides it.
    const home = c.country.trim() || 'India';
    const abroad = c.workAuthorization.filter((w) => norm(w.country) !== norm(home));
    if (abroad.some((w) => w.authorized && loc.includes(norm(w.country)))) location = Math.max(location, 0.7);
    else if (c.otherCountries?.authorized === false && !abroad.some((w) => w.authorized)) reject(`Based in ${listing.location || 'another country'}, outside where you can work.`);
    else gaps.push(`Based in ${listing.location || 'another country'}; you may need a work permit.`);
  }

  // Employment type.
  if (config.employmentTypes.length && req.employmentType && !config.employmentTypes.includes(req.employmentType)) {
    reject(`It’s a ${EMPLOYMENT_LABEL[req.employmentType]} role; you excluded those.`);
  }

  // Salary.
  let salary = req.salaryMaxLpa !== null ? 1 : 0.7;
  if (config.minSalaryLpa !== null && req.salaryMaxLpa !== null) {
    if (req.salaryMaxLpa < config.minSalaryLpa) {
      reject(`Pays up to ₹${req.salaryMaxLpa} LPA, below your ₹${config.minSalaryLpa} LPA minimum.`);
      salary = 0;
    } else reasons.push(`Pays up to ₹${req.salaryMaxLpa} LPA.`);
  }

  // Degree: a gap only ("or equivalent experience" is common, and parsing degrees is imperfect).
  if (req.degreeRequired && c.degrees?.length && Math.max(...c.degrees.map(degreeRank)) < (degreeRank(req.degreeRequired) || 0)) {
    gaps.push(`Asks for a ${req.degreeRequired} degree.`);
  }

  // Recency.
  const { fit: recency, days } = recencyFit(listing.postedAt, listing.now ?? new Date());
  if (days !== null && days > config.maxPostedDays) reject(`Posted ${Math.floor(days)} days ago; likely filled.`);
  else if (days !== null && days <= 3) reasons.push('Posted in the last 3 days.');

  const components = { title, skills, experience, location, salary, recency };
  const w = config.weights;
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  let score = (Object.keys(components) as (keyof MatchWeights)[]).reduce((s, k) => s + components[k] * w[k], 0) / total;
  // A different kind of job isn't a good match however many skills overlap.
  if (title < 0.3) score *= 0.6;

  return {
    score: pct(score),
    eligible: rejections.length === 0,
    components: {
      title: pct(title), skills: pct(skills), experience: pct(experience), location: pct(location), salary: pct(salary), recency: pct(recency),
    },
    mandatoryMatched,
    mandatoryMissing,
    preferredMatched,
    reasons: reasons.slice(0, 6),
    gaps: [...new Set(gaps)].slice(0, 6),
    rejections,
  };
}

// ---- Tailoring fact guard ---------------------------------------------------------------------------

const DEGREE_WORDS = /\b(ph\.?\s?d|doctorate|mba|m\.?\s?tech|b\.?\s?tech|master'?s|bachelor'?s|msc|bsc|m\.sc|b\.sc|mca|bca|b\.e\.|m\.e\.)\b/gi;

/**
 * Facts a rewritten resume line states that the source resume doesn't: skills and tools from the
 * lexicon or the candidate's skills, degrees, certifications, acronyms and employers ("at Google").
 * Any hit means the line would claim something the candidate never said.
 */
export function unsupportedTerms(text: string, source: string): string[] {
  const src = source.toLowerCase();
  const srcSkills = new Set(lexiconSkills(source).map((s) => s.toLowerCase()));
  const out = new Set<string>();
  for (const s of lexiconSkills(text)) if (!srcSkills.has(s.toLowerCase())) out.add(s);
  for (const m of text.matchAll(DEGREE_WORDS)) {
    if (!src.includes(m[0].toLowerCase().replace(/\s+/g, ' ')) && !src.includes(m[0].toLowerCase().replace(/[.\s]/g, ''))) out.add(m[0]);
  }
  for (const m of text.matchAll(/\b((?:[A-Z][\w+-]*\s+){0,4}Certifi(?:ed|cation)(?:\s+[A-Z][\w+-]*){0,4})/g)) {
    if (!src.includes(m[1].trim().toLowerCase())) out.add(m[1].trim());
  }
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9]{1,5}s?\b/g)) {
    const a = m[0].replace(/s$/, '');
    if (!new RegExp(`(?:^|[^a-z0-9])${escapeRe(a)}`, 'i').test(source)) out.add(a);
  }
  for (const m of text.matchAll(/\b(?:at|for|with|joined)\s+((?:[A-Z][\w&.-]+)(?:\s+[A-Z][\w&.-]+){0,3})/g)) {
    const name = m[1].replace(/[.,]+$/, '');
    // Sentence-start capitals ("with Python") are skills, checked above; employers are multi-letter names.
    if (name.length > 2 && !src.includes(name.toLowerCase()) && !lexiconSkills(name).length) out.add(name);
  }
  return [...out];
}
