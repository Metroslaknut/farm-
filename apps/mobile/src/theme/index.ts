import { theme, type Theme } from './theme';

export { palette } from './palette';
export { theme, type Theme, type StatusTone } from './theme';

/** Hook form so a future light/dark or brand switch needs no call-site changes. */
export const useTheme = (): Theme => theme;
