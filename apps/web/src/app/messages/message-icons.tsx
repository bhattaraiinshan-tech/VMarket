import type { SVGProps } from 'react';

const paths = {
  account: 'M20 21v-2a7 7 0 0 0-14 0v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  orders: 'm3 7 9-5 9 5v10l-9 5-9-5V7Zm0 0 9 5 9-5M12 12v10M7 4l10 5',
  message:
    'M21 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 19 0ZM7 10h.01M12 10h.01M17 10h.01',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-2 7-2 9h16c0-2-2-2-2-9M10 21h4',
  support:
    'M3 14v-3a9 9 0 0 1 18 0v3M3 12h3v7H3v-7Zm15 0h3v7h-3v-7ZM18 19c0 2-2 3-6 3',
  shop: 'M3 10v11h18V10M2 3h20l-1 7c-2 2-4 2-6 0-2 2-4 2-6 0-2 2-4 2-6 0L2 3ZM9 21v-7h6v7',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  compose:
    'M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M15 3l6 6M10 14l1-5 8-8 4 4-8 8-5 1Z',
  phone: 'M5 3H2v4c0 8 7 15 15 15h4v-5l-6-2-2 3a16 16 0 0 1-7-7l3-2-2-6H5Z',
  video: 'M15 8l7-4v16l-7-4M2 5h13v14H2V5Z',
  more: 'M12 4h.01M12 12h.01M12 20h.01',
  smile:
    'M8 14s1 3 4 3 4-3 4-3M8 9h.01M16 9h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  clip: 'm8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7L13 2a7 7 0 0 1 10 10L13 22',
  image: 'M3 3h18v18H3V3Zm0 14 6-6 4 4 3-3 5 5M8 7h.01',
  send: 'm22 2-7 20-4-9-9-4 20-7ZM11 13 22 2',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  back: 'M20 12H4m6-6-6 6 6 6',
  check: 'm4 12 5 5L20 6',
  doubleCheck: 'm1 12 5 5L17 6m-5 10 2 1L25 6',
  cart: 'M2 3h3l3 13h12l3-10H6M9 21h.01M19 21h.01',
  heart: 'M20 13 12 21 4 13C-4 5 6-2 12 5c6-7 16 0 8 8Z',
} as const;

export type MessageIconName = keyof typeof paths;

export function MessageIcon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: MessageIconName }) {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox={name === 'doubleCheck' ? '0 0 28 24' : '0 0 24 24'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
