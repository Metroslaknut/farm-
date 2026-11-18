import { palette } from './palette';

/**
 * Semantic theme (white + red). Components use these roles only.
 * Brand red is for actions and emphasis; `error` is a separate role so a failure is never mistaken for a brand accent
 * (and every status is also conveyed by an icon/label, not colour alone).
 */
export const theme = {
  colors: {
    background: palette.white,
    surface: palette.gray50, // cards, inputs' resting background, secondary areas
    surfaceAlt: palette.gray100, // pressed rows, skeletons
    border: palette.gray200, // dividers (decorative)
    borderStrong: palette.gray400, // control outlines (identifies the control)

    text: palette.gray900,
    textMuted: palette.gray600,
    textOnPrimary: palette.white,
    /** Full-screen media (video): letterbox background and text drawn over it. */
    mediaBackground: palette.black,
    onMedia: palette.white,

    primary: palette.red600,
    primaryPressed: palette.red700,
    primarySoft: palette.red50,

    tabActive: palette.red600,
    tabInactive: palette.gray600,

    success: { fg: palette.green700, bg: palette.green50 },
    warning: { fg: palette.amber800, bg: palette.amber50 },
    error: { fg: palette.crimson800, bg: palette.crimson50 },

    /** "Continue with Google / Facebook" buttons follow the providers' brand guidelines. */
    social: {
      facebook: palette.facebookBlue,
      facebookPressed: palette.facebookBluePressed,
      onFacebook: palette.white,
      googleMark: palette.googleBlue,
    },
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  radius: { sm: 8, md: 12, lg: 16, pill: 999 },
  font: {
    size: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, xxl: 28 },
    weight: { regular: '400', medium: '500', bold: '700' },
  },
  /** Minimum touch target (iOS HIG 44pt / Material 48dp → use 48). */
  minTouch: 48,
} as const;

export type Theme = typeof theme;
export type StatusTone = 'success' | 'warning' | 'error';
