export type PermissionResult = 'granted' | 'denied' | 'blocked';

/** Normalise Expo's permission response. `blocked` = "Don't ask again": only the Settings app can change it. */
export function toResult(response: { granted: boolean; canAskAgain: boolean }): PermissionResult {
  if (response.granted) return 'granted';
  return response.canAskAgain ? 'denied' : 'blocked';
}
