import type { SVGProps } from 'react';

/** Line icons (24×24, 1.75 stroke, currentColor) for the storefront chrome. Decorative unless a `title` is given. */
const PATHS = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4.2-4.2',
  cart: 'M3 4h2l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.7a1.5 1.5 0 0 0 1.4-1.1L21 8H6.2M9.5 20.5h.01M17.5 20.5h.01',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7.5 8.5c.8-3.6 3.9-5.5 7.5-5.5s6.7 1.9 7.5 5.5',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Zm4 4.5a2 2 0 0 0 4 0',
  chat: 'M4 5h16v11H9l-4 3.5V16H4z',
  grid: 'M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z',
  chevronDown: 'm6 9 6 6 6-6',
  chevronLeft: 'm15 6-6 6 6 6',
  chevronRight: 'm9 6 6 6-6 6',
  arrowRight: 'M5 12h14m-5-5 5 5-5 5',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 5v14l11-7z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  tag: 'M3.5 12.5V4h8.5l8.5 8.5-8.5 8.5zM8 8.5h.01',
  shield: 'M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6zm-3.5 9 2.5 2.5 4.5-5',
  truck:
    'M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  store:
    'M4 9.5 5.5 4h13L20 9.5M4 9.5h16M4 9.5c0 1.4 1.1 2.5 2.7 2.5s2.6-1.1 2.6-2.5c0 1.4 1.1 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1 2.5 2.6 2.5S20 10.9 20 9.5M5.5 12v8h13v-8M10 20v-4.5h4V20',
  sprout:
    'M12 20v-8m0 0c0-3.5-2.5-6-6.5-6 0 3.5 2.5 6 6.5 6Zm0-2c0-3 2.2-5.5 6.5-5.5 0 3-2.2 5.5-6.5 5.5Z',
  wheat:
    'M12 21V9m0 0c-2-1.3-2.6-3.3-2-5.5 2 .8 2.8 2.9 2 5.5Zm0 0c2-1.3 2.6-3.3 2-5.5-2 .8-2.8 2.9-2 5.5Zm0 4.5c-2.4-.4-3.8-2-4-4.4 2.3.1 3.8 1.7 4 4.4Zm0 0c2.4-.4 3.8-2 4-4.4-2.3.1-3.8 1.7-4 4.4Zm0 4.5c-2.4-.4-3.8-2-4-4.4 2.3.1 3.8 1.7 4 4.4Zm0 0c2.4-.4 3.8-2 4-4.4-2.3.1-3.8 1.7-4 4.4Z',
  pill: 'M10.5 20.5a5 5 0 0 1-7-7l6-6a5 5 0 0 1 7 7zM8.5 8.5l7 7',
  tools:
    'M15 4.5a4.5 4.5 0 0 0-4.3 5.9l-6.2 6.2a2 2 0 0 0 2.9 2.9l6.2-6.2A4.5 4.5 0 0 0 19.5 9l-2.7 2.7-2.6-.9-.9-2.6L16 5.5A4.5 4.5 0 0 0 15 4.5Z',
  box: 'M12 3 4 7v10l8 4 8-4V7zm0 0v18M4 7l8 4 8-4',
  cow: 'M7 8c-1.8 0-3-1-3.5-2.5C5 5.5 6 6 7 6m10 2c1.8 0 3-1 3.5-2.5C19 5.5 18 6 17 6M7 6h10v5.5c0 1.6-.7 3-2 3.8V18a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-2.7c-1.3-.8-2-2.2-2-3.8zM10.5 17h.01M13.5 17h.01',
  home: 'M4 11 12 4l8 7v9H4zM10 20v-6h4v6',
  users:
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9c.6-3.3 3-5 6-5s5.4 1.7 6 5m1-9a3 3 0 1 0 0-6m2 15h3c-.4-2.6-2-4.2-4.2-4.8',
  video: 'M3.5 6h12v12h-12zM15.5 10l5-3v10l-5-3',
  live: 'M12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm-3.5-5a5 5 0 0 0 0 7m7 0a5 5 0 0 0 0-7M5.6 5.6a9 9 0 0 0 0 12.8m12.8 0a9 9 0 0 0 0-12.8',
  pin: 'M12 21s7-6 7-11.5a7 7 0 1 0-14 0C5 15 12 21 12 21Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  star: 'm12 4 2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z',
  wallet: 'M4 7h15v12H4zm0 0 11-3v3m1 7h.01',
  clipboard: 'M9 4h6v3H9zM7 5.5H5.5V20h13V5.5H17M8.5 11h7m-7 4h5',
  plus: 'M12 5v14M5 12h14',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  eyeOff:
    'M3 3l18 18M10.6 5.6c.5-.1.9-.1 1.4-.1 6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 3.9M6.6 6.7C3.9 8.4 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.8 0 3.3-.5 4.6-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2',
  mail: 'M3.5 6h17v12h-17zm0 0 8.5 7 8.5-7',
  phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm3 15h2',
  check: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-4-9 2.8 2.8L16 9.5',
  alert: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5m0 3.5h.01',
  translate:
    'M4 5h8M8 3v2m2.5 0c-.8 4-3.3 7-6.5 8.5M6 9c1 2 2.8 3.5 5 4.5M12.5 21l4-10 4 10m-6.8-3h5.6',
  trendUp: 'm3 17 6-6 4 4 8-8m-5 0h5v5',
  trendDown: 'm3 7 6 6 4-4 8 8m-5 0h5v-5',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 20,
  title,
  ...rest
}: { name: IconName; size?: number; title?: string } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}
