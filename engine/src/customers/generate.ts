import type { DeviceKind, DeviceProfile, SyntheticCustomer } from '../domain/types.ts';
import { randomId } from '../util/ids.ts';
import { Rng } from '../util/rng.ts';
import { nowIso } from '../util/time.ts';

/**
 * Synthetic contact data is generated so it can never reach a real person:
 *  - emails use the reserved `.invalid` top-level domain (RFC 2606) — not deliverable;
 *  - phone numbers use the 555-01xx block reserved for fictional use (NANPA).
 */
export const SYNTHETIC_EMAIL_DOMAIN = 'synthetic.syntro.invalid';

const FIRST_NAMES = [
  'Sarah', 'Daniel', 'Priya', 'Marcus', 'Elena', 'Tomas', 'Aisha', 'Noah', 'Hannah', 'Leo',
  'Maya', 'Omar', 'Ingrid', 'Rafael', 'Chloe', 'Kenji', 'Amara', 'Felix', 'Nadia', 'Victor',
  'Zoe', 'Mateo', 'Freya', 'Idris', 'Lucia', 'Jonas', 'Mira', 'Theo', 'Yara', 'Oscar',
];

const LAST_NAMES = [
  'Lindqvist', 'Okafor', 'Ramaswamy', 'Novak', 'Castillo', 'Haddad', 'Fischer', 'Moreau', 'Tanaka', 'Byrne',
  'Varga', 'Osei', 'Kowalski', 'Mendes', 'Sato', 'Dubois', 'Nkemelu', 'Berg', 'Ivanova', 'Quintero',
  'Hoffmann', 'Abara', 'Rossi', 'Nair', 'Petrov', 'Larsen', 'Achebe', 'Ferreira', 'Kim', 'Walsh',
];

export const DEVICE_PROFILES: DeviceProfile[] = [
  {
    kind: 'desktop',
    os: 'Windows 11',
    browser: 'Chrome 130',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Syntro-Synthetic/1.0',
    viewport: { width: 1366, height: 820 },
  },
  {
    kind: 'desktop',
    os: 'macOS 15',
    browser: 'Safari 18',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 Syntro-Synthetic/1.0',
    viewport: { width: 1440, height: 860 },
  },
  {
    kind: 'mobile',
    os: 'iOS 18',
    browser: 'Mobile Safari',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 Syntro-Synthetic/1.0',
    viewport: { width: 390, height: 844 },
  },
  {
    kind: 'mobile',
    os: 'Android 15',
    browser: 'Chrome Mobile 130',
    userAgent:
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 Syntro-Synthetic/1.0',
    viewport: { width: 412, height: 915 },
  },
  {
    kind: 'tablet',
    os: 'iPadOS 18',
    browser: 'Mobile Safari',
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 Syntro-Synthetic/1.0',
    viewport: { width: 1024, height: 1366 },
  },
];

export function deviceProfileFor(kind: DeviceKind, rng: Rng): DeviceProfile {
  const candidates = DEVICE_PROFILES.filter((d) => d.kind === kind);
  return { ...rng.pick(candidates.length ? candidates : DEVICE_PROFILES) };
}

export interface GenerateCustomersInput {
  runId: string;
  projectId: string;
  scenarioId: string;
  journeyId: string;
  count: number;
  seed: number | string;
  startIndex?: number;
  attributes?: Record<string, string | number | boolean>;
  /** Weighted mix of device kinds; default favours desktop. */
  deviceMix?: Partial<Record<DeviceKind, number>>;
}

export function generateCustomers(input: GenerateCustomersInput): SyntheticCustomer[] {
  const count = Math.max(1, Math.min(100, Math.floor(input.count)));
  const rng = new Rng(`${input.seed}:${input.scenarioId}`);
  const mix = { desktop: 0.6, mobile: 0.3, tablet: 0.1, ...(input.deviceMix ?? {}) };
  const startIndex = input.startIndex ?? 1;
  const customers: SyntheticCustomer[] = [];
  const usedNames = new Set<string>();

  for (let i = 0; i < count; i++) {
    const index = startIndex + i;
    let firstName = rng.pick(FIRST_NAMES);
    let lastName = rng.pick(LAST_NAMES);
    let guard = 0;
    while (usedNames.has(`${firstName} ${lastName}`) && guard++ < 20) {
      firstName = rng.pick(FIRST_NAMES);
      lastName = rng.pick(LAST_NAMES);
    }
    usedNames.add(`${firstName} ${lastName}`);

    const roll = rng.next();
    const kind: DeviceKind = roll < mix.desktop ? 'desktop' : roll < mix.desktop + mix.mobile ? 'mobile' : 'tablet';
    const device = deviceProfileFor(kind, rng);
    const id = randomId('cust');
    const slug = `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z.]/g, '');

    customers.push({
      id,
      runId: input.runId,
      projectId: input.projectId,
      scenarioId: input.scenarioId,
      journeyId: input.journeyId,
      index,
      firstName,
      lastName,
      email: `${slug}.${index}@${SYNTHETIC_EMAIL_DOMAIN}`,
      phone: `+1 555 01${String(rng.int(0, 99)).padStart(2, '0')}`,
      device,
      attributes: {
        persona: rng.pick(['value_seeker', 'brand_loyal', 'researcher', 'impulse']),
        region: rng.pick(['NA', 'EU', 'APAC']),
        ...(input.attributes ?? {}),
      },
      sessions: [],
      activeFaults: [],
      status: 'pending',
      createdAt: nowIso(),
    });
  }
  return customers;
}

export function customerDisplayName(c: Pick<SyntheticCustomer, 'firstName' | 'lastName'>): string {
  return `${c.firstName} ${c.lastName}`;
}
