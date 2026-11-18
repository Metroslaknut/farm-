/**
 * Detects values that must never leave the server. Used on API responses (and by the repository scan). Names are matched
 * case-insensitively; `…Masked` fields are the deliberately masked forms.
 */
const SECRET_KEY =
  /(password(?!Changed)|passwordhash|tokenhash|refreshtoken(hash)?$|totp|mfa(secret|key)|recoverycode(s|hash)?$|secret(?!ary)|apikey|privatekey|addressenc|accountnumber(?!masked)|webhooksecret|keyhash|otphash)/i;
const SECRET_VALUE: [string, RegExp][] = [
  ['argon2/bcrypt hash', /\$argon2(id|i|d)\$|\$2[aby]\$\d\d\$/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['connection string with credentials', /mongodb(\+srv)?:\/\/[^\s:@/]+:[^\s@/]+@/],
  ['bearer token', /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/],
];

export function findSecrets(value: unknown, path = '$', depth = 0): string[] {
  if (depth > 12) return [];
  const out: string[] = [];
  if (typeof value === 'string') {
    for (const [name, re] of SECRET_VALUE)
      if (re.test(value)) out.push(`${path} contains a ${name}`);
  } else if (Array.isArray(value)) {
    value.slice(0, 200).forEach((v, i) => out.push(...findSecrets(v, `${path}[${i}]`, depth + 1)));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(k) && v !== null && v !== undefined && v !== false && v !== '')
        out.push(`${path}.${k} is a secret-looking field`);
      out.push(...findSecrets(v, `${path}.${k}`, depth + 1));
    }
  }
  return out;
}
