import type { ReactNode } from 'react'

// Stroke icons on a 24px grid, drawn to match each other in weight.
const PATHS: Record<string, ReactNode> = {
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  back: <path d="M19 12H5M12 19l-7-7 7-7" />,
  up: <path d="M12 19V5M5 12l7-7 7 7" />,
  reload: <path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.7L21 8M21 3v5h-5" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 3.8 5.6 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.6-3.8-9S9.500 5.500 12 3z" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h9M19 7h1M4 17h3M13 17h7" />
      <circle cx="16" cy="7" r="2.500" />
      <circle cx="10" cy="17" r="2.500" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V4h6v3M18 7l-1 13H7L6 7" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  bolt: <path d="M13 3 4 14h7l-1 7 9-11h-7l1-7z" />,
  agents: (
    <>
      <circle cx="6" cy="6" r="2.500" />
      <circle cx="18" cy="6" r="2.500" />
      <circle cx="12" cy="18" r="2.500" />
      <path d="M6 8.500V10a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V8.500M12 13v2.500" />
    </>
  ),
  compose: <path d="M12 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6M17.500 3.500a2.100 2.100 0 0 1 3 3L12 15l-4 1 1-4z" />,
  check: <path d="m5 12 5 5 9-10" />,
  power: <path d="M12 3v9M18.400 6.600a9 9 0 1 1-12.800 0" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.300" fill="currentColor" />
      <circle cx="12" cy="12" r="1.300" fill="currentColor" />
      <circle cx="19" cy="12" r="1.300" fill="currentColor" />
    </>
  ),
  thought: <path d="M12 3v2M12 19v2M3 12h2M19 12h2M6 6l1.500 1.500M16.500 16.500 18 18M6 18l1.500-1.500M16.500 7.500 18 6" />,
  backspace: <path d="M21 5H9l-6 7 6 7h12zM17 9l-5 6M12 9l5 6" />,
  enter: <path d="M20 5v8H6M10 9l-4 4 4 4" />,
  file: <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  plug: <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4" />,
  book: <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11" />,
  history: <path d="M3 12a9 9 0 1 0 3-6.700L3 8M3 3v5h5M12 7v5l3 2" />,
  download: <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />,
  upload: <path d="M12 16V5M7 9l5-5 5 5M5 20h14" />,
  undo: <path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.900 4.900l1.400 1.400M17.700 17.700l1.400 1.400M2 12h2M20 12h2M4.900 19.100l1.400-1.400M17.700 6.300l1.400-1.400" />
    </>
  ),
  message: <path d="M21 12a8 8 0 0 1-8 8H4l2.300-2.900A8 8 0 1 1 21 12z" />,
  cpu: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </>
  ),
  bot: (
    <>
      <rect x="4" y="8" width="16" height="11" rx="3" />
      <path d="M12 8V4.500M9 13v1.500M15 13v1.500" />
      <circle cx="12" cy="3.500" r="1" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  wifi: <path d="M2 9a15 15 0 0 1 20 0M5.500 12.500a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M12 19.500h.010" />,
  wrench: <path d="M14.700 6.300a4 4 0 0 0-5.400 5.200L3 17.800V21h3.200l6.300-6.300a4 4 0 0 0 5.200-5.400l-2.600 2.600-2.200-.600-.600-2.200z" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.010" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.600-7 10-7 10 7 10 7-3.600 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
}

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg
      className="ic"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.800"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  )
}
