export const CANONICAL_TIMEZONES = Object.freeze({
  EAST_AFRICA: "EAT",
  US_PACIFIC: "PST",
});

export const ALLOWED_LOCATION_TIMEZONES = Object.freeze([
  CANONICAL_TIMEZONES.EAST_AFRICA,
  CANONICAL_TIMEZONES.US_PACIFIC,
]);

const CODE_TO_IANA = Object.freeze({
  [CANONICAL_TIMEZONES.EAST_AFRICA]: "Africa/Nairobi",
  [CANONICAL_TIMEZONES.US_PACIFIC]: "America/Los_Angeles",
});

const TIMEZONE_ALIASES = Object.freeze({
  // East Africa aliases.
  "east africa": CANONICAL_TIMEZONES.EAST_AFRICA,
  "east-africa": CANONICAL_TIMEZONES.EAST_AFRICA,
  "africa/nairobi": CANONICAL_TIMEZONES.EAST_AFRICA,
  "africa/daressalaam": CANONICAL_TIMEZONES.EAST_AFRICA,
  "africa/dares salaam": CANONICAL_TIMEZONES.EAST_AFRICA,
  "africa/dares-salaam": CANONICAL_TIMEZONES.EAST_AFRICA,
  "africa/daresalaam": CANONICAL_TIMEZONES.EAST_AFRICA,
  "africa/dar es salaam": CANONICAL_TIMEZONES.EAST_AFRICA,
  "africa/dar_es_salaam": CANONICAL_TIMEZONES.EAST_AFRICA,
  "africa/dares_salaam": CANONICAL_TIMEZONES.EAST_AFRICA,
  eat: CANONICAL_TIMEZONES.EAST_AFRICA,
  "eat (utc+3)": CANONICAL_TIMEZONES.EAST_AFRICA,
  "eat (utc +3)": CANONICAL_TIMEZONES.EAST_AFRICA,
  "eat (utc+03:00)": CANONICAL_TIMEZONES.EAST_AFRICA,
  "eat (utc +03:00)": CANONICAL_TIMEZONES.EAST_AFRICA,

  // Pacific aliases.
  pst: CANONICAL_TIMEZONES.US_PACIFIC,
  pdt: CANONICAL_TIMEZONES.US_PACIFIC,
  pt: CANONICAL_TIMEZONES.US_PACIFIC,
  "pacific": CANONICAL_TIMEZONES.US_PACIFIC,
  "pacific time": CANONICAL_TIMEZONES.US_PACIFIC,
  "us/pacific": CANONICAL_TIMEZONES.US_PACIFIC,
  "america/los_angeles": CANONICAL_TIMEZONES.US_PACIFIC,
  "america/los angeles": CANONICAL_TIMEZONES.US_PACIFIC,
});

export const isValidIanaTimezone = (timezone) => {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

export const resolveTimezoneAlias = (value) => {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  return TIMEZONE_ALIASES[trimmed.toLowerCase()] || trimmed;
};

export const normalizeTimezone = (
  value,
  { fallback = CANONICAL_TIMEZONES.EAST_AFRICA, restrictToAllowed = false } = {}
) => {
  const resolved = resolveTimezoneAlias(value);
  if (!resolved) return fallback;
  if (!ALLOWED_LOCATION_TIMEZONES.includes(resolved)) return fallback;
  if (restrictToAllowed && !ALLOWED_LOCATION_TIMEZONES.includes(resolved)) {
    return fallback;
  }
  return resolved;
};

export const toIanaTimezone = (value) => {
  const normalized = normalizeTimezone(value, {
    fallback: CANONICAL_TIMEZONES.EAST_AFRICA,
    restrictToAllowed: true,
  });
  return CODE_TO_IANA[normalized] || CODE_TO_IANA[CANONICAL_TIMEZONES.EAST_AFRICA];
};

export const toTimezoneLabel = (timezone) => {
  const normalized = normalizeTimezone(timezone, {
    fallback: CANONICAL_TIMEZONES.EAST_AFRICA,
    restrictToAllowed: true,
  });
  if (normalized === CANONICAL_TIMEZONES.US_PACIFIC) {
    return "PST (UTC-8 / -7 DST)";
  }
  return "EAT (UTC+3)";
};
