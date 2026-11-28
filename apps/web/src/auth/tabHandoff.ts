import type { AuthTokens } from '@farmplus/shared-types';

/**
 * Tab hand-off (staging QA #14): a new tab of the same browser has no session (refresh tokens live in each tab's
 * sessionStorage). It asks an open, signed-in FARM+ tab on a same-origin BroadcastChannel; that tab asks the API for
 * a separate session (`POST /auth/session/handoff`: refresh tokens are single-use, so a tab never shares its own) and
 * passes the new tokens back. Nothing is written to localStorage or cookies except a "someone is signed in" hint, so a
 * guest's first page does not wait for an answer that will never come.
 *
 * Handshake (one session per request, even with several tabs open): new tab `ask` → each signed-in tab `offer` →
 * the new tab picks the first and sends `take` → that tab replies `session` (or `none`).
 */
const CHANNEL = 'farmplus.auth';
const HINT = 'farmplus.signedInTab';
const OFFER_WAIT_MS = 400;
const SESSION_WAIT_MS = 6000;

type Message =
  | { type: 'ask'; from: string }
  | { type: 'offer'; from: string; to: string }
  | { type: 'take'; from: string; to: string }
  | { type: 'session'; to: string; tokens: AuthTokens }
  | { type: 'none'; to: string };

const tabId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

const channel = (): BroadcastChannel | null =>
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);

/** Whether some tab of this browser said it was signed in (a hint only: no token is stored). */
function hinted(): boolean {
  try {
    return localStorage.getItem(HINT) === '1';
  } catch {
    return false;
  }
}

export function setSignedInHint(signedIn: boolean): void {
  try {
    if (signedIn) localStorage.setItem(HINT, '1');
    else localStorage.removeItem(HINT);
  } catch {
    /* storage blocked: the next new tab simply signs in */
  }
}

/** New tab: ask the other tabs for a session. Resolves to null when none answers. */
export function requestSessionFromOtherTab(): Promise<AuthTokens | null> {
  const bc = channel();
  if (!bc || !hinted()) {
    bc?.close();
    return Promise.resolve(null);
  }
  const me = tabId();
  return new Promise((resolve) => {
    let taken = false;
    const done = (tokens: AuthTokens | null) => {
      clearTimeout(offerTimer);
      clearTimeout(sessionTimer);
      bc.close();
      resolve(tokens);
    };
    const offerTimer = setTimeout(() => {
      if (!taken) done(null); // no signed-in tab answered (the hint was stale)
    }, OFFER_WAIT_MS);
    let sessionTimer: ReturnType<typeof setTimeout> | undefined;
    bc.onmessage = (event: MessageEvent<Message>) => {
      const m = event.data;
      if (m.type === 'offer' && m.to === me && !taken) {
        taken = true;
        bc.postMessage({ type: 'take', from: me, to: m.from } satisfies Message);
        sessionTimer = setTimeout(() => done(null), SESSION_WAIT_MS);
      } else if (m.type === 'session' && m.to === me) done(m.tokens);
      else if (m.type === 'none' && m.to === me) done(null);
    };
    bc.postMessage({ type: 'ask', from: me } satisfies Message);
  });
}

/**
 * Signed-in tab: answer other tabs' requests while signed in. `createSession` asks the API for a separate session.
 * Returns a function that stops answering (on sign-out or unmount).
 */
export function answerOtherTabs(createSession: () => Promise<AuthTokens>): () => void {
  const bc = channel();
  if (!bc) return () => undefined;
  const me = tabId();
  bc.onmessage = (event: MessageEvent<Message>) => {
    const m = event.data;
    if (m.type === 'ask') bc.postMessage({ type: 'offer', from: me, to: m.from } satisfies Message);
    else if (m.type === 'take' && m.to === me)
      createSession().then(
        (tokens) => bc.postMessage({ type: 'session', to: m.from, tokens } satisfies Message),
        () => bc.postMessage({ type: 'none', to: m.from } satisfies Message),
      );
  };
  return () => bc.close();
}
