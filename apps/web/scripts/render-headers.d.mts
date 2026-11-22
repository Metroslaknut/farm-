export const THIRD_PARTY_CONNECT: string[];
export const THIRD_PARTY_FRAMES: string[];
export function originOf(url: string | undefined, label: string): string | null;
export function inlineScriptHashes(html: string): string[];
export function buildCsp(options: {
  apiOrigin: string | null;
  mediaHosts?: string[];
  scriptHashes?: string[];
}): string;
export function buildHeaders(options: {
  html: string;
  apiBase?: string | undefined;
  mediaHosts?: string[] | undefined;
}): {
  headers: string;
  redirects: string;
  csp: string;
};
