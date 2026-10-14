/**
 * World city & IANA timezone catalog + timezone calculation helpers.
 *
 * Detects at startup whether Intl.DateTimeFormat honours the `timeZone` option
 * (in bronze, Intl.DateTimeFormat currently ignores `timeZone` and uses the
 * host timezone). When `timeZone` is ignored, falls back to exact UTC offset +
 * regional DST rules (US, EU, AU, NZ) so any instant formats accurately across
 * all supported IANA zones.
 */

import { shellPref } from '/lib/settings.js';

export const CITIES = [
  // North America
  { id: 'new-york', city: 'New York', country: 'United States', zone: 'America/New_York', offsetMin: -300, dst: 'us' },
  { id: 'chicago', city: 'Chicago', country: 'United States', zone: 'America/Chicago', offsetMin: -360, dst: 'us' },
  { id: 'denver', city: 'Denver', country: 'United States', zone: 'America/Denver', offsetMin: -420, dst: 'us' },
  { id: 'los-angeles', city: 'Los Angeles', country: 'United States', zone: 'America/Los_Angeles', offsetMin: -480, dst: 'us' },
  { id: 'san-francisco', city: 'San Francisco', country: 'United States', zone: 'America/Los_Angeles', offsetMin: -480, dst: 'us' },
  { id: 'seattle', city: 'Seattle', country: 'United States', zone: 'America/Los_Angeles', offsetMin: -480, dst: 'us' },
  { id: 'boston', city: 'Boston', country: 'United States', zone: 'America/New_York', offsetMin: -300, dst: 'us' },
  { id: 'washington-dc', city: 'Washington, D.C.', country: 'United States', zone: 'America/New_York', offsetMin: -300, dst: 'us' },
  { id: 'miami', city: 'Miami', country: 'United States', zone: 'America/New_York', offsetMin: -300, dst: 'us' },
  { id: 'atlanta', city: 'Atlanta', country: 'United States', zone: 'America/New_York', offsetMin: -300, dst: 'us' },
  { id: 'dallas', city: 'Dallas', country: 'United States', zone: 'America/Chicago', offsetMin: -360, dst: 'us' },
  { id: 'houston', city: 'Houston', country: 'United States', zone: 'America/Chicago', offsetMin: -360, dst: 'us' },
  { id: 'phoenix', city: 'Phoenix', country: 'United States', zone: 'America/Phoenix', offsetMin: -420, dst: null },
  { id: 'anchorage', city: 'Anchorage', country: 'United States', zone: 'America/Anchorage', offsetMin: -540, dst: 'us' },
  { id: 'honolulu', city: 'Honolulu', country: 'United States', zone: 'Pacific/Honolulu', offsetMin: -600, dst: null },
  { id: 'toronto', city: 'Toronto', country: 'Canada', zone: 'America/Toronto', offsetMin: -300, dst: 'us' },
  { id: 'montreal', city: 'Montreal', country: 'Canada', zone: 'America/Toronto', offsetMin: -300, dst: 'us' },
  { id: 'vancouver', city: 'Vancouver', country: 'Canada', zone: 'America/Vancouver', offsetMin: -480, dst: 'us' },
  { id: 'calgary', city: 'Calgary', country: 'Canada', zone: 'America/Edmonton', offsetMin: -420, dst: 'us' },
  { id: 'halifax', city: 'Halifax', country: 'Canada', zone: 'America/Halifax', offsetMin: -240, dst: 'us' },
  { id: 'st-johns', city: "St. John's", country: 'Canada', zone: 'America/St_Johns', offsetMin: -210, dst: 'us' },
  { id: 'mexico-city', city: 'Mexico City', country: 'Mexico', zone: 'America/Mexico_City', offsetMin: -360, dst: null },
  { id: 'cancun', city: 'Cancun', country: 'Mexico', zone: 'America/Cancun', offsetMin: -300, dst: null },
  { id: 'tijuana', city: 'Tijuana', country: 'Mexico', zone: 'America/Tijuana', offsetMin: -480, dst: 'us' },
  { id: 'havana', city: 'Havana', country: 'Cuba', zone: 'America/Havana', offsetMin: -300, dst: 'us' },
  { id: 'panama-city', city: 'Panama City', country: 'Panama', zone: 'America/Panama', offsetMin: -300, dst: null },
  { id: 'san-jose-cr', city: 'San Jose', country: 'Costa Rica', zone: 'America/Costa_Rica', offsetMin: -360, dst: null },
  { id: 'san-juan', city: 'San Juan', country: 'Puerto Rico', zone: 'America/Puerto_Rico', offsetMin: -240, dst: null },

  // South America
  { id: 'sao-paulo', city: 'Sao Paulo', country: 'Brazil', zone: 'America/Sao_Paulo', offsetMin: -180, dst: null },
  { id: 'rio-de-janeiro', city: 'Rio de Janeiro', country: 'Brazil', zone: 'America/Sao_Paulo', offsetMin: -180, dst: null },
  { id: 'brasilia', city: 'Brasilia', country: 'Brazil', zone: 'America/Sao_Paulo', offsetMin: -180, dst: null },
  { id: 'manaus', city: 'Manaus', country: 'Brazil', zone: 'America/Manaus', offsetMin: -240, dst: null },
  { id: 'buenos-aires', city: 'Buenos Aires', country: 'Argentina', zone: 'America/Argentina/Buenos_Aires', offsetMin: -180, dst: null },
  { id: 'santiago', city: 'Santiago', country: 'Chile', zone: 'America/Santiago', offsetMin: -240, dst: null },
  { id: 'bogota', city: 'Bogota', country: 'Colombia', zone: 'America/Bogota', offsetMin: -300, dst: null },
  { id: 'lima', city: 'Lima', country: 'Peru', zone: 'America/Lima', offsetMin: -300, dst: null },
  { id: 'caracas', city: 'Caracas', country: 'Venezuela', zone: 'America/Caracas', offsetMin: -240, dst: null },
  { id: 'quito', city: 'Quito', country: 'Ecuador', zone: 'America/Guayaquil', offsetMin: -300, dst: null },
  { id: 'montevideo', city: 'Montevideo', country: 'Uruguay', zone: 'America/Montevideo', offsetMin: -180, dst: null },
  { id: 'la-paz', city: 'La Paz', country: 'Bolivia', zone: 'America/La_Paz', offsetMin: -240, dst: null },
  { id: 'asuncion', city: 'Asuncion', country: 'Paraguay', zone: 'America/Asuncion', offsetMin: -240, dst: null },

  // Europe & UTC
  { id: 'utc', city: 'UTC', country: 'Coordinated Universal Time', zone: 'UTC', offsetMin: 0, dst: null },
  { id: 'reykjavik', city: 'Reykjavik', country: 'Iceland', zone: 'Atlantic/Reykjavik', offsetMin: 0, dst: null },
  { id: 'london', city: 'London', country: 'United Kingdom', zone: 'Europe/London', offsetMin: 0, dst: 'eu' },
  { id: 'edinburgh', city: 'Edinburgh', country: 'United Kingdom', zone: 'Europe/London', offsetMin: 0, dst: 'eu' },
  { id: 'dublin', city: 'Dublin', country: 'Ireland', zone: 'Europe/Dublin', offsetMin: 0, dst: 'eu' },
  { id: 'lisbon', city: 'Lisbon', country: 'Portugal', zone: 'Europe/Lisbon', offsetMin: 0, dst: 'eu' },
  { id: 'paris', city: 'Paris', country: 'France', zone: 'Europe/Paris', offsetMin: 60, dst: 'eu' },
  { id: 'berlin', city: 'Berlin', country: 'Germany', zone: 'Europe/Berlin', offsetMin: 60, dst: 'eu' },
  { id: 'frankfurt', city: 'Frankfurt', country: 'Germany', zone: 'Europe/Berlin', offsetMin: 60, dst: 'eu' },
  { id: 'munich', city: 'Munich', country: 'Germany', zone: 'Europe/Berlin', offsetMin: 60, dst: 'eu' },
  { id: 'madrid', city: 'Madrid', country: 'Spain', zone: 'Europe/Madrid', offsetMin: 60, dst: 'eu' },
  { id: 'barcelona', city: 'Barcelona', country: 'Spain', zone: 'Europe/Madrid', offsetMin: 60, dst: 'eu' },
  { id: 'rome', city: 'Rome', country: 'Italy', zone: 'Europe/Rome', offsetMin: 60, dst: 'eu' },
  { id: 'milan', city: 'Milan', country: 'Italy', zone: 'Europe/Rome', offsetMin: 60, dst: 'eu' },
  { id: 'amsterdam', city: 'Amsterdam', country: 'Netherlands', zone: 'Europe/Amsterdam', offsetMin: 60, dst: 'eu' },
  { id: 'brussels', city: 'Brussels', country: 'Belgium', zone: 'Europe/Brussels', offsetMin: 60, dst: 'eu' },
  { id: 'zurich', city: 'Zurich', country: 'Switzerland', zone: 'Europe/Zurich', offsetMin: 60, dst: 'eu' },
  { id: 'geneva', city: 'Geneva', country: 'Switzerland', zone: 'Europe/Zurich', offsetMin: 60, dst: 'eu' },
  { id: 'vienna', city: 'Vienna', country: 'Austria', zone: 'Europe/Vienna', offsetMin: 60, dst: 'eu' },
  { id: 'prague', city: 'Prague', country: 'Czechia', zone: 'Europe/Prague', offsetMin: 60, dst: 'eu' },
  { id: 'warsaw', city: 'Warsaw', country: 'Poland', zone: 'Europe/Warsaw', offsetMin: 60, dst: 'eu' },
  { id: 'budapest', city: 'Budapest', country: 'Hungary', zone: 'Europe/Budapest', offsetMin: 60, dst: 'eu' },
  { id: 'stockholm', city: 'Stockholm', country: 'Sweden', zone: 'Europe/Stockholm', offsetMin: 60, dst: 'eu' },
  { id: 'oslo', city: 'Oslo', country: 'Norway', zone: 'Europe/Oslo', offsetMin: 60, dst: 'eu' },
  { id: 'copenhagen', city: 'Copenhagen', country: 'Denmark', zone: 'Europe/Copenhagen', offsetMin: 60, dst: 'eu' },
  { id: 'helsinki', city: 'Helsinki', country: 'Finland', zone: 'Europe/Helsinki', offsetMin: 120, dst: 'eu' },
  { id: 'tallinn', city: 'Tallinn', country: 'Estonia', zone: 'Europe/Tallinn', offsetMin: 120, dst: 'eu' },
  { id: 'riga', city: 'Riga', country: 'Latvia', zone: 'Europe/Riga', offsetMin: 120, dst: 'eu' },
  { id: 'vilnius', city: 'Vilnius', country: 'Lithuania', zone: 'Europe/Vilnius', offsetMin: 120, dst: 'eu' },
  { id: 'athens', city: 'Athens', country: 'Greece', zone: 'Europe/Athens', offsetMin: 120, dst: 'eu' },
  { id: 'bucharest', city: 'Bucharest', country: 'Romania', zone: 'Europe/Bucharest', offsetMin: 120, dst: 'eu' },
  { id: 'sofia', city: 'Sofia', country: 'Bulgaria', zone: 'Europe/Sofia', offsetMin: 120, dst: 'eu' },
  { id: 'kyiv', city: 'Kyiv', country: 'Ukraine', zone: 'Europe/Kyiv', offsetMin: 120, dst: 'eu' },
  { id: 'istanbul', city: 'Istanbul', country: 'Turkey', zone: 'Europe/Istanbul', offsetMin: 180, dst: null },
  { id: 'ankara', city: 'Ankara', country: 'Turkey', zone: 'Europe/Istanbul', offsetMin: 180, dst: null },
  { id: 'moscow', city: 'Moscow', country: 'Russia', zone: 'Europe/Moscow', offsetMin: 180, dst: null },
  { id: 'belgrade', city: 'Belgrade', country: 'Serbia', zone: 'Europe/Belgrade', offsetMin: 60, dst: 'eu' },
  { id: 'zagreb', city: 'Zagreb', country: 'Croatia', zone: 'Europe/Zagreb', offsetMin: 60, dst: 'eu' },

  // Africa & Middle East
  { id: 'cairo', city: 'Cairo', country: 'Egypt', zone: 'Africa/Cairo', offsetMin: 120, dst: null },
  { id: 'casablanca', city: 'Casablanca', country: 'Morocco', zone: 'Africa/Casablanca', offsetMin: 60, dst: null },
  { id: 'algiers', city: 'Algiers', country: 'Algeria', zone: 'Africa/Algiers', offsetMin: 60, dst: null },
  { id: 'tunis', city: 'Tunis', country: 'Tunisia', zone: 'Africa/Tunis', offsetMin: 60, dst: null },
  { id: 'lagos', city: 'Lagos', country: 'Nigeria', zone: 'Africa/Lagos', offsetMin: 60, dst: null },
  { id: 'accra', city: 'Accra', country: 'Ghana', zone: 'Africa/Accra', offsetMin: 0, dst: null },
  { id: 'dakar', city: 'Dakar', country: 'Senegal', zone: 'Africa/Dakar', offsetMin: 0, dst: null },
  { id: 'nairobi', city: 'Nairobi', country: 'Kenya', zone: 'Africa/Nairobi', offsetMin: 180, dst: null },
  { id: 'addis-ababa', city: 'Addis Ababa', country: 'Ethiopia', zone: 'Africa/Addis_Ababa', offsetMin: 180, dst: null },
  { id: 'dar-es-salaam', city: 'Dar es Salaam', country: 'Tanzania', zone: 'Africa/Dar_es_Salaam', offsetMin: 180, dst: null },
  { id: 'johannesburg', city: 'Johannesburg', country: 'South Africa', zone: 'Africa/Johannesburg', offsetMin: 120, dst: null },
  { id: 'cape-town', city: 'Cape Town', country: 'South Africa', zone: 'Africa/Johannesburg', offsetMin: 120, dst: null },
  { id: 'jerusalem', city: 'Jerusalem', country: 'Israel', zone: 'Asia/Jerusalem', offsetMin: 120, dst: 'eu' },
  { id: 'tel-aviv', city: 'Tel Aviv', country: 'Israel', zone: 'Asia/Jerusalem', offsetMin: 120, dst: 'eu' },
  { id: 'beirut', city: 'Beirut', country: 'Lebanon', zone: 'Asia/Beirut', offsetMin: 120, dst: 'eu' },
  { id: 'amman', city: 'Amman', country: 'Jordan', zone: 'Asia/Amman', offsetMin: 180, dst: null },
  { id: 'riyadh', city: 'Riyadh', country: 'Saudi Arabia', zone: 'Asia/Riyadh', offsetMin: 180, dst: null },
  { id: 'jeddah', city: 'Jeddah', country: 'Saudi Arabia', zone: 'Asia/Riyadh', offsetMin: 180, dst: null },
  { id: 'doha', city: 'Doha', country: 'Qatar', zone: 'Asia/Qatar', offsetMin: 180, dst: null },
  { id: 'kuwait-city', city: 'Kuwait City', country: 'Kuwait', zone: 'Asia/Kuwait', offsetMin: 180, dst: null },
  { id: 'baghdad', city: 'Baghdad', country: 'Iraq', zone: 'Asia/Baghdad', offsetMin: 180, dst: null },
  { id: 'dubai', city: 'Dubai', country: 'United Arab Emirates', zone: 'Asia/Dubai', offsetMin: 240, dst: null },
  { id: 'abu-dhabi', city: 'Abu Dhabi', country: 'United Arab Emirates', zone: 'Asia/Dubai', offsetMin: 240, dst: null },
  { id: 'muscat', city: 'Muscat', country: 'Oman', zone: 'Asia/Muscat', offsetMin: 240, dst: null },
  { id: 'tehran', city: 'Tehran', country: 'Iran', zone: 'Asia/Tehran', offsetMin: 210, dst: null },
  { id: 'baku', city: 'Baku', country: 'Azerbaijan', zone: 'Asia/Baku', offsetMin: 240, dst: null },
  { id: 'tbilisi', city: 'Tbilisi', country: 'Georgia', zone: 'Asia/Tbilisi', offsetMin: 240, dst: null },
  { id: 'yerevan', city: 'Yerevan', country: 'Armenia', zone: 'Asia/Yerevan', offsetMin: 240, dst: null },

  // Asia
  { id: 'kabul', city: 'Kabul', country: 'Afghanistan', zone: 'Asia/Kabul', offsetMin: 270, dst: null },
  { id: 'tashkent', city: 'Tashkent', country: 'Uzbekistan', zone: 'Asia/Tashkent', offsetMin: 300, dst: null },
  { id: 'almaty', city: 'Almaty', country: 'Kazakhstan', zone: 'Asia/Almaty', offsetMin: 300, dst: null },
  { id: 'karachi', city: 'Karachi', country: 'Pakistan', zone: 'Asia/Karachi', offsetMin: 300, dst: null },
  { id: 'lahore', city: 'Lahore', country: 'Pakistan', zone: 'Asia/Karachi', offsetMin: 300, dst: null },
  { id: 'islamabad', city: 'Islamabad', country: 'Pakistan', zone: 'Asia/Karachi', offsetMin: 300, dst: null },
  { id: 'mumbai', city: 'Mumbai', country: 'India', zone: 'Asia/Kolkata', offsetMin: 330, dst: null },
  { id: 'new-delhi', city: 'New Delhi', country: 'India', zone: 'Asia/Kolkata', offsetMin: 330, dst: null },
  { id: 'bengaluru', city: 'Bengaluru', country: 'India', zone: 'Asia/Kolkata', offsetMin: 330, dst: null },
  { id: 'chennai', city: 'Chennai', country: 'India', zone: 'Asia/Kolkata', offsetMin: 330, dst: null },
  { id: 'kolkata', city: 'Kolkata', country: 'India', zone: 'Asia/Kolkata', offsetMin: 330, dst: null },
  { id: 'colombo', city: 'Colombo', country: 'Sri Lanka', zone: 'Asia/Colombo', offsetMin: 330, dst: null },
  { id: 'kathmandu', city: 'Kathmandu', country: 'Nepal', zone: 'Asia/Kathmandu', offsetMin: 345, dst: null },
  { id: 'dhaka', city: 'Dhaka', country: 'Bangladesh', zone: 'Asia/Dhaka', offsetMin: 360, dst: null },
  { id: 'yangon', city: 'Yangon', country: 'Myanmar', zone: 'Asia/Yangon', offsetMin: 390, dst: null },
  { id: 'bangkok', city: 'Bangkok', country: 'Thailand', zone: 'Asia/Bangkok', offsetMin: 420, dst: null },
  { id: 'ho-chi-minh-city', city: 'Ho Chi Minh City', country: 'Vietnam', zone: 'Asia/Ho_Chi_Minh', offsetMin: 420, dst: null },
  { id: 'hanoi', city: 'Hanoi', country: 'Vietnam', zone: 'Asia/Bangkok', offsetMin: 420, dst: null },
  { id: 'phnom-penh', city: 'Phnom Penh', country: 'Cambodia', zone: 'Asia/Phnom_Penh', offsetMin: 420, dst: null },
  { id: 'jakarta', city: 'Jakarta', country: 'Indonesia', zone: 'Asia/Jakarta', offsetMin: 420, dst: null },
  { id: 'bali', city: 'Denpasar (Bali)', country: 'Indonesia', zone: 'Asia/Makassar', offsetMin: 480, dst: null },
  { id: 'singapore', city: 'Singapore', country: 'Singapore', zone: 'Asia/Singapore', offsetMin: 480, dst: null },
  { id: 'kuala-lumpur', city: 'Kuala Lumpur', country: 'Malaysia', zone: 'Asia/Kuala_Lumpur', offsetMin: 480, dst: null },
  { id: 'manila', city: 'Manila', country: 'Philippines', zone: 'Asia/Manila', offsetMin: 480, dst: null },
  { id: 'hong-kong', city: 'Hong Kong', country: 'China', zone: 'Asia/Hong_Kong', offsetMin: 480, dst: null },
  { id: 'taipei', city: 'Taipei', country: 'Taiwan', zone: 'Asia/Taipei', offsetMin: 480, dst: null },
  { id: 'beijing', city: 'Beijing', country: 'China', zone: 'Asia/Shanghai', offsetMin: 480, dst: null },
  { id: 'shanghai', city: 'Shanghai', country: 'China', zone: 'Asia/Shanghai', offsetMin: 480, dst: null },
  { id: 'shenzhen', city: 'Shenzhen', country: 'China', zone: 'Asia/Shanghai', offsetMin: 480, dst: null },
  { id: 'perth', city: 'Perth', country: 'Australia', zone: 'Australia/Perth', offsetMin: 480, dst: null },
  { id: 'ulaanbaatar', city: 'Ulaanbaatar', country: 'Mongolia', zone: 'Asia/Ulaanbaatar', offsetMin: 480, dst: null },
  { id: 'seoul', city: 'Seoul', country: 'South Korea', zone: 'Asia/Seoul', offsetMin: 540, dst: null },
  { id: 'tokyo', city: 'Tokyo', country: 'Japan', zone: 'Asia/Tokyo', offsetMin: 540, dst: null },
  { id: 'osaka', city: 'Osaka', country: 'Japan', zone: 'Asia/Tokyo', offsetMin: 540, dst: null },
  { id: 'kyoto', city: 'Kyoto', country: 'Japan', zone: 'Asia/Tokyo', offsetMin: 540, dst: null },
  { id: 'vladivostok', city: 'Vladivostok', country: 'Russia', zone: 'Asia/Vladivostok', offsetMin: 600, dst: null },

  // Oceania
  { id: 'darwin', city: 'Darwin', country: 'Australia', zone: 'Australia/Darwin', offsetMin: 570, dst: null },
  { id: 'adelaide', city: 'Adelaide', country: 'Australia', zone: 'Australia/Adelaide', offsetMin: 570, dst: 'au' },
  { id: 'brisbane', city: 'Brisbane', country: 'Australia', zone: 'Australia/Brisbane', offsetMin: 600, dst: null },
  { id: 'sydney', city: 'Sydney', country: 'Australia', zone: 'Australia/Sydney', offsetMin: 600, dst: 'au' },
  { id: 'melbourne', city: 'Melbourne', country: 'Australia', zone: 'Australia/Melbourne', offsetMin: 600, dst: 'au' },
  { id: 'hobart', city: 'Hobart', country: 'Australia', zone: 'Australia/Hobart', offsetMin: 600, dst: 'au' },
  { id: 'port-moresby', city: 'Port Moresby', country: 'Papua New Guinea', zone: 'Pacific/Port_Moresby', offsetMin: 600, dst: null },
  { id: 'noumea', city: 'Noumea', country: 'New Caledonia', zone: 'Pacific/Noumea', offsetMin: 660, dst: null },
  { id: 'suva', city: 'Suva', country: 'Fiji', zone: 'Pacific/Fiji', offsetMin: 720, dst: null },
  { id: 'auckland', city: 'Auckland', country: 'New Zealand', zone: 'Pacific/Auckland', offsetMin: 720, dst: 'nz' },
  { id: 'wellington', city: 'Wellington', country: 'New Zealand', zone: 'Pacific/Auckland', offsetMin: 720, dst: 'nz' },
];

const BY_ID = new Map();
const BY_ZONE = new Map();
for (const c of CITIES) {
  BY_ID.set(c.id, c);
  if (!BY_ZONE.has(c.zone)) BY_ZONE.set(c.zone, c);
}

/** Detect at startup whether Intl.DateTimeFormat actually shifts time for timeZone. */
export const INTL_TZ_WORKS = (() => {
  try {
    const ref = Date.UTC(2024, 0, 15, 12, 0, 0);
    const utcStr = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: '2-digit', hour12: false }).format(ref);
    const tokyoStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: '2-digit', hour12: false }).format(ref);
    return utcStr !== tokyoStr;
  } catch (_) {
    return false;
  }
})();

/** Find a city entry by id or IANA zone. */
export function findCity(idOrZone) {
  if (!idOrZone) return null;
  return BY_ID.get(idOrZone) || BY_ZONE.get(idOrZone) || null;
}

/** Search cities by city name, country, or IANA zone. */
export function searchCities(query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return CITIES;
  return CITIES.filter((c) =>
    c.city.toLowerCase().includes(q) ||
    c.country.toLowerCase().includes(q) ||
    c.zone.toLowerCase().includes(q)
  );
}

/** Day of week (0=Sun..6=Sat) of the 1st of (year, month0) in UTC. */
function firstDowUTC(year, month0) {
  return new Date(Date.UTC(year, month0, 1)).getUTCDay();
}

/** Date of the Nth Sunday (1-indexed) in (year, month0). */
function nthSundayUTC(year, month0, n) {
  const dow = firstDowUTC(year, month0);
  const firstSun = dow === 0 ? 1 : 8 - dow;
  return firstSun + (n - 1) * 7;
}

/** Date of the last Sunday in (year, month0). */
function lastSundayUTC(year, month0) {
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const lastDow = new Date(Date.UTC(year, month0, daysInMonth)).getUTCDay();
  return daysInMonth - lastDow;
}

/** Compute DST extra minutes (0 or 60) for a given epochMs and zone record. */
function dstExtraMinutes(epochMs, stdOffsetMin, rule) {
  if (!rule) return 0;
  const d = new Date(epochMs);
  const y = d.getUTCFullYear();
  if (rule === 'us') {
    // 2nd Sunday in March at 02:00 standard time -> 1st Sunday in November at 02:00 daylight time
    const marSun = nthSundayUTC(y, 2, 2);
    const novSun = nthSundayUTC(y, 10, 1);
    const startUtc = Date.UTC(y, 2, marSun, 2, 0, 0) - stdOffsetMin * 60000;
    const endUtc = Date.UTC(y, 10, novSun, 2, 0, 0) - (stdOffsetMin + 60) * 60000;
    return epochMs >= startUtc && epochMs < endUtc ? 60 : 0;
  }
  if (rule === 'eu') {
    // Last Sunday in March 01:00 UTC -> Last Sunday in October 01:00 UTC
    const marSun = lastSundayUTC(y, 2);
    const octSun = lastSundayUTC(y, 9);
    const startUtc = Date.UTC(y, 2, marSun, 1, 0, 0);
    const endUtc = Date.UTC(y, 9, octSun, 1, 0, 0);
    return epochMs >= startUtc && epochMs < endUtc ? 60 : 0;
  }
  if (rule === 'au') {
    // 1st Sunday in October 02:00 standard -> 1st Sunday in April 03:00 daylight (Southern Hemisphere)
    const aprSun = nthSundayUTC(y, 3, 1);
    const octSun = nthSundayUTC(y, 9, 1);
    const endUtc = Date.UTC(y, 3, aprSun, 3, 0, 0) - (stdOffsetMin + 60) * 60000;
    const startUtc = Date.UTC(y, 9, octSun, 2, 0, 0) - stdOffsetMin * 60000;
    return epochMs < endUtc || epochMs >= startUtc ? 60 : 0;
  }
  if (rule === 'nz') {
    // Last Sunday in September 02:00 standard -> 1st Sunday in April 03:00 daylight
    const aprSun = nthSundayUTC(y, 3, 1);
    const sepSun = lastSundayUTC(y, 8);
    const endUtc = Date.UTC(y, 3, aprSun, 3, 0, 0) - (stdOffsetMin + 60) * 60000;
    const startUtc = Date.UTC(y, 8, sepSun, 2, 0, 0) - stdOffsetMin * 60000;
    return epochMs < endUtc || epochMs >= startUtc ? 60 : 0;
  }
  return 0;
}

/**
 * Total UTC offset in minutes for `zone` at `epochMs` (e.g. +540 for Asia/Tokyo,
 * -300 for America/New_York in winter). When `zone` is null/empty/'local',
 * returns the host's local offset in minutes (-Date.getTimezoneOffset()).
 */
export function getZoneOffsetMin(epochMs, zone) {
  if (!zone || zone === 'local') {
    return -new Date(epochMs).getTimezoneOffset();
  }
  if (zone === 'UTC' || zone === 'Etc/UTC' || zone === 'GMT') return 0;
  const info = BY_ZONE.get(zone) || BY_ID.get(zone);
  if (info) {
    return info.offsetMin + dstExtraMinutes(epochMs, info.offsetMin, info.dst);
  }
  if (INTL_TZ_WORKS) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).formatToParts(new Date(epochMs));
      const m = {};
      for (const p of parts) m[p.type] = Number(p.value);
      const hr = m.hour === 24 ? 0 : m.hour;
      const asUtc = Date.UTC(m.year, m.month - 1, m.day, hr, m.minute, m.second);
      return Math.round((asUtc - epochMs) / 60000);
    } catch (_) {
      // fall through
    }
  }
  return -new Date(epochMs).getTimezoneOffset();
}

/**
 * Compute broken-down calendar fields in `zone` for `epochMs`.
 * Returns { year, month (1..12), day (1..31), weekday (0..6), hour (0..23), minute, second, offsetMin }.
 */
export function getZonedParts(epochMs, zone) {
  if (!zone || zone === 'local') {
    const d = new Date(epochMs);
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      weekday: d.getDay(),
      hour: d.getHours(),
      minute: d.getMinutes(),
      second: d.getSeconds(),
      offsetMin: -d.getTimezoneOffset(),
    };
  }
  const offsetMin = getZoneOffsetMin(epochMs, zone);
  const shifted = new Date(epochMs + offsetMin * 60000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    offsetMin,
  };
}

/**
 * Format an instant in `zone` as HH:MM (or HH:MM:SS, or 12-hour with AM/PM).
 * Defaults `use24h` to helm's shell preference (`true` by default).
 */
export function formatInZone(epochMs, zone, { use24h = shellPref('use24h'), seconds = false } = {}) {
  const p = getZonedParts(epochMs, zone);
  const mm = String(p.minute).padStart(2, '0');
  const ss = seconds ? `:${String(p.second).padStart(2, '0')}` : '';
  if (use24h !== false) {
    return `${String(p.hour).padStart(2, '0')}:${mm}${ss}`;
  }
  const hr12 = p.hour % 12 || 12;
  const ampm = p.hour < 12 ? 'AM' : 'PM';
  return `${hr12}:${mm}${ss} ${ampm}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Format date label in `zone` (e.g. "Mon, Jan 15"). */
export function formatDateInZone(epochMs, zone) {
  const p = getZonedParts(epochMs, zone);
  return `${DAYS[p.weekday]}, ${MONTHS[p.month - 1]} ${p.day}`;
}

/**
 * Compare a target `zone` against `refZone` (defaults to local timezone, or
 * 'UTC' if specified) at `epochMs`.
 * Returns { dayLabel: 'Today'|'Tomorrow'|'Yesterday', diffMin, offsetLabel: '+9 h'|'-5 h'|'Same time', isDay: boolean }.
 */
export function getRelativeDayAndOffset(epochMs, zone, refZone = 'local') {
  const target = getZonedParts(epochMs, zone);
  const ref = getZonedParts(epochMs, refZone);

  const targetDayUtc = Date.UTC(target.year, target.month - 1, target.day);
  const refDayUtc = Date.UTC(ref.year, ref.month - 1, ref.day);
  const dayDiff = Math.round((targetDayUtc - refDayUtc) / 86400000);
  const dayLabel = dayDiff > 0 ? 'Tomorrow' : dayDiff < 0 ? 'Yesterday' : 'Today';

  const diffMin = target.offsetMin - ref.offsetMin;
  let offsetLabel = 'Same time';
  if (diffMin !== 0) {
    const sign = diffMin > 0 ? '+' : '-';
    const abs = Math.abs(diffMin);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    offsetLabel = m === 0 ? `${sign}${h} h` : `${sign}${h}:${String(m).padStart(2, '0')} h`;
  }

  const isDay = target.hour >= 6 && target.hour < 18;
  return { dayLabel, dayDiff, diffMin, offsetLabel, isDay, parts: target };
}
