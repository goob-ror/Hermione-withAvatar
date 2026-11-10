/**
 * Countries Google Trends publishes a daily feed for, plus a local
 * (no network) guess of the operator's country from their time zone / locale.
 * Shared by server and client — no Node imports here.
 */

export interface Country {
  code: string // ISO 3166-1 alpha-2, also the Google Trends `geo`
  name: string
  flag: string
}

const RAW: Array<[string, string]> = [
  ['ID', 'Indonesia'], ['US', 'United States'], ['GB', 'United Kingdom'], ['IN', 'India'],
  ['PH', 'Philippines'], ['MY', 'Malaysia'], ['SG', 'Singapore'], ['TH', 'Thailand'],
  ['VN', 'Vietnam'], ['JP', 'Japan'], ['KR', 'South Korea'], ['TW', 'Taiwan'],
  ['HK', 'Hong Kong'], ['AU', 'Australia'], ['NZ', 'New Zealand'], ['CA', 'Canada'],
  ['MX', 'Mexico'], ['BR', 'Brazil'], ['AR', 'Argentina'], ['CO', 'Colombia'],
  ['CL', 'Chile'], ['PE', 'Peru'], ['DE', 'Germany'], ['FR', 'France'],
  ['ES', 'Spain'], ['IT', 'Italy'], ['NL', 'Netherlands'], ['BE', 'Belgium'],
  ['SE', 'Sweden'], ['NO', 'Norway'], ['DK', 'Denmark'], ['FI', 'Finland'],
  ['PL', 'Poland'], ['PT', 'Portugal'], ['IE', 'Ireland'], ['AT', 'Austria'],
  ['CH', 'Switzerland'], ['CZ', 'Czechia'], ['RO', 'Romania'], ['GR', 'Greece'],
  ['TR', 'Türkiye'], ['UA', 'Ukraine'], ['IL', 'Israel'], ['SA', 'Saudi Arabia'],
  ['AE', 'United Arab Emirates'], ['EG', 'Egypt'], ['NG', 'Nigeria'], ['KE', 'Kenya'],
  ['ZA', 'South Africa'],
]

function flagOf(code: string): string {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

export const COUNTRIES: Country[] = RAW.map(([code, name]) => ({ code, name, flag: flagOf(code) }))

export function countryByCode(code?: string | null): Country | undefined {
  if (!code) return undefined
  const upper = code.toUpperCase()
  return COUNTRIES.find((c) => c.code === upper)
}

/** IANA zone → country. Zones shared by several countries are left out. */
const TZ: Record<string, string> = {
  'Asia/Jakarta': 'ID', 'Asia/Makassar': 'ID', 'Asia/Jayapura': 'ID', 'Asia/Pontianak': 'ID',
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Los_Angeles': 'US',
  'America/Phoenix': 'US', 'America/Anchorage': 'US', 'Pacific/Honolulu': 'US', 'America/Detroit': 'US',
  'Europe/London': 'GB', 'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Manila': 'PH',
  'Asia/Kuala_Lumpur': 'MY', 'Asia/Kuching': 'MY', 'Asia/Singapore': 'SG', 'Asia/Bangkok': 'TH',
  'Asia/Ho_Chi_Minh': 'VN', 'Asia/Saigon': 'VN', 'Asia/Tokyo': 'JP', 'Asia/Seoul': 'KR',
  'Asia/Taipei': 'TW', 'Asia/Hong_Kong': 'HK', 'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU',
  'Australia/Brisbane': 'AU', 'Australia/Perth': 'AU', 'Australia/Adelaide': 'AU', 'Pacific/Auckland': 'NZ',
  'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Edmonton': 'CA', 'America/Mexico_City': 'MX',
  'America/Sao_Paulo': 'BR', 'America/Argentina/Buenos_Aires': 'AR', 'America/Bogota': 'CO',
  'America/Santiago': 'CL', 'America/Lima': 'PE', 'Europe/Berlin': 'DE', 'Europe/Paris': 'FR',
  'Europe/Madrid': 'ES', 'Europe/Rome': 'IT', 'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE',
  'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO', 'Europe/Copenhagen': 'DK', 'Europe/Helsinki': 'FI',
  'Europe/Warsaw': 'PL', 'Europe/Lisbon': 'PT', 'Europe/Dublin': 'IE', 'Europe/Vienna': 'AT',
  'Europe/Zurich': 'CH', 'Europe/Prague': 'CZ', 'Europe/Bucharest': 'RO', 'Europe/Athens': 'GR',
  'Europe/Istanbul': 'TR', 'Europe/Kyiv': 'UA', 'Europe/Kiev': 'UA', 'Asia/Jerusalem': 'IL',
  'Asia/Riyadh': 'SA', 'Asia/Dubai': 'AE', 'Africa/Cairo': 'EG', 'Africa/Lagos': 'NG',
  'Africa/Nairobi': 'KE', 'Africa/Johannesburg': 'ZA',
}

/**
 * Best local guess, browser-side. Time zone first (it tracks where the
 * machine is), then the locale's region, then US. No IP lookup.
 */
export function guessCountry(): Country {
  try {
    const opts = Intl.DateTimeFormat().resolvedOptions()
    const byTz = countryByCode(TZ[opts.timeZone])
    if (byTz) return byTz
    const region = (opts.locale || '').split('-').find((part) => /^[A-Z]{2}$/.test(part))
    const byLocale = countryByCode(region)
    if (byLocale) return byLocale
  } catch {
    /* fall through */
  }
  return countryByCode('US')!
}
