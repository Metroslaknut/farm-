/**
 * Raw colour palette — the ONLY place hex values live. Change the brand here (or swap the whole object)
 * and every screen follows, because components read semantic roles from `theme.ts`, never these values.
 */
export const palette = {
  white: '#FFFFFF',
  black: '#000000',

  red600: '#C62828', // brand red (white text on it = AA)
  red700: '#A81F1F', // pressed
  red50: '#FDECEC', // subtle brand tint

  gray50: '#F7F7F8',
  gray100: '#EFEFF1',
  gray200: '#DEDEE2',
  gray400: '#8A8A92', // control borders (>= 3:1 on white)
  gray600: '#5C5C64', // secondary text
  gray900: '#1A1A1C', // primary text

  green700: '#1B6E31',
  green50: '#E6F4EA',
  amber800: '#7A4B00',
  amber50: '#FFF3D6',
  crimson800: '#A8001C',
  crimson50: '#FBE4E6',

  // Third-party sign-in brands (their own guidelines; used only on the Google / Facebook buttons)
  facebookBlue: '#1877F2',
  facebookBluePressed: '#166FE5',
  googleBlue: '#4285F4',
} as const;
