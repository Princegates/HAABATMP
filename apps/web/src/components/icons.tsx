import type { SVGProps } from 'react';

const P: Record<string, React.ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="8" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="15" width="7" height="6" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.5c1.9.8 3 2.7 3 5.5" /></>,
  building: <><rect x="4" y="3" width="10" height="18" /><path d="M14 9h6v12h-6M8 7h2M8 11h2M8 15h2M17 13h0M17 17h0" /></>,
  book: <><path d="M4 5.5C4 4.7 4.7 4 5.5 4H12v16H5.5C4.7 20 4 19.3 4 18.5z" /><path d="M12 4h6.5c.8 0 1.5.7 1.5 1.5v13c0 .8-.7 1.5-1.5 1.5H12" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  attendance: <><rect x="5" y="4" width="14" height="17" /><path d="M9 4V3h6v1M9 13l2 2 4-4" /></>,
  file: <><path d="M6 3h8l5 5v13H6z" /><path d="M14 3v5h5M9 13h7M9 17h7" /></>,
  chart: <><path d="M4 20V4M4 20h16" /><path d="M8 16v-4M12 16V8M16 16v-6" /></>,
  award: <><circle cx="12" cy="9" r="5.5" /><path d="M8.5 14l-1.5 7 5-3 5 3-1.5-7" /></>,
  card: <><rect x="3" y="6" width="18" height="13" /><path d="M3 10.5h18M7 15h4" /></>,
  shield: <><path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>,
  folder: <><path d="M3 6.5C3 5.7 3.7 5 4.5 5H10l2 2.5h7.5c.8 0 1.5.7 1.5 1.5v9c0 .8-.7 1.5-1.5 1.5h-15C3.7 19.5 3 18.8 3 18z" /></>,
  reports: <><rect x="4" y="3" width="16" height="18" /><path d="M8 15v-3M12 15V8M16 15v-5" /></>,
  bell: <><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z" /><path d="M10 21h4" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l5 5" /></>,
  settings: <><circle cx="12" cy="12" r="3.2" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8" /></>,
  moon: <><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></>,
  chevron: <><path d="M9 6l6 6-6 6" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  logout: <><path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  download: <><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></>,
  check: <><path d="M5 12.5l4.5 4.5L19 7" /></>,
  x: <><path d="M6 6l12 12M18 6L6 18" /></>,
  qr: <><rect x="4" y="4" width="6" height="6" /><rect x="14" y="4" width="6" height="6" /><rect x="4" y="14" width="6" height="6" /><path d="M14 14h2v2h-2zM18 14h2v2M14 18h2M18 18h2v2" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M16 7l3 3M14 9l2 2" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  alert: <><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18h0" /></>,
  plug: <><path d="M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v3" /></>,
  list: <><path d="M8 6h12M8 12h12M8 18h12M4 6h0M4 12h0M4 18h0" /></>,
  edit: <><path d="M4 20l1-4 11-11 3 3L8 19zM14 7l3 3" /></>,
  upload: <><path d="M12 16V5M7 9l5-5 5 5M5 20h14" /></>,
  eye: <><path d="M2 12s3.7-7 10-7 10 7 10 7-3.7 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
};

export type IconName = keyof typeof P;

export function Icon({ name, ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" {...rest}>
      {P[name]}
    </svg>
  );
}
