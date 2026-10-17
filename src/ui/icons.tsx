/** Material-style 24×24 icons, drawn in currentColor. Paths from Material Icons (Apache License 2.0); the shelf icons below are eReaderPlus's own. */
const PATHS = {
  menu: 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z',
  search:
    'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  moreVert:
    'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  moreHoriz:
    'M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  star: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  starOutline:
    'M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z',
  viewList: 'M3 14h4v-4H3v4zm0 5h4v-4H3v4zM3 9h4V5H3v4zm5 5h13v-4H8v4zm0 5h13v-4H8v4zM8 5v4h13V5H8z',
  viewGrid:
    'M3 3v8h8V3H3zm6 6H5V5h4v4zm-6 4v8h8v-8H3zm6 6H5v-4h4v4zm4-16v8h8V3h-8zm6 6h-4V5h4v4zm-6 4v8h8v-8h-8zm6 6h-4v-4h4v4z',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  toc: 'M3 9h14V7H3v2zm0 4h14v-2H3v2zm0 4h14v-2H3v2zm16 0h2v-2h-2v2zm0-10v2h2V7h-2zm0 6h2v-2h-2v2z',
  settings:
    'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
  person: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  folder: 'M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
  book: 'M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z',
  addCircle:
    'M13 7h-2v4H7v2h4v4h2v-4h4v-2h-4V7zm-1-5C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z',
  removeCircle:
    'M7 11v2h10v-2H7zm5-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  info: 'M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z',
  chevronLeft: 'M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z',
  chevronRight: 'M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  openFile:
    'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 14h-3v3h-2v-3H8v-2h3v-3h2v3h3v2zm-3-7V3.5L18.5 9H13z',
} as const;

/**
 * eReaderPlus's own shelf icons, on the same 24×24 grid: `fill` shapes (inner shapes cut holes) or `lines`
 * drawn with a round pen (.icon-line in App.css).
 */
type ShelfIconName = 'readingNow' | 'books' | 'toRead' | 'finished' | 'series' | 'collections' | 'formats' | 'onePage' | 'twoPages';

const SHELF_ICONS: Record<ShelfIconName, { fill: string[] } | { lines: string[] }> = {
  // Reading glasses.
  readingNow: {
    lines: [
      'M3 15a3.5 3.5 0 1 0 7 0 3.5 3.5 0 1 0-7 0z',
      'M14 15a3.5 3.5 0 1 0 7 0 3.5 3.5 0 1 0-7 0z',
      'M10 14.6c1.3-.9 2.7-.9 4 0',
      'M3.4 13.6 5.5 7.5',
      'M20.6 13.6 18.5 7.5',
    ],
  },
  // A closed book.
  books: { fill: ['M7.5 2.5h12v14h-12A2.5 2.5 0 0 0 5 19V5a2.5 2.5 0 0 1 2.5-2.5z', 'M7.6 18h11.9v3.5H7.6a1.75 1.75 0 0 1 0-3.5z'] },
  // A bookmark with a plus.
  toRead: { fill: ['M7.5 2.5h9A1.5 1.5 0 0 1 18 4v17.5l-6-4-6 4V4a1.5 1.5 0 0 1 1.5-1.5zM11.1 6.5v2.6H8.5v1.8h2.6v2.6h1.8v-2.6h2.6V9.1h-2.6V6.5z'] },
  // A finish flag.
  finished: { fill: ['M5.6 2.5a1 1 0 0 1 1 1v17.5a1 1 0 0 1-2 0V3.5a1 1 0 0 1 1-1z', 'M7.6 3.8h11.1l-2.8 4.7 2.8 4.7H7.6z'] },
  // Volumes stacked one behind the other.
  series: {
    fill: [
      'M5.5 7h8.5A2.5 2.5 0 0 1 16.5 9.5v9a2.5 2.5 0 0 1-2.5 2.5H5.5A2.5 2.5 0 0 1 3 18.5v-9A2.5 2.5 0 0 1 5.5 7z',
      'M8 2.5h10.5a3 3 0 0 1 3 3V16h-2V5.5a1 1 0 0 0-1-1H8z',
    ],
  },
  // A folder with a heart.
  collections: { fill: ['M5 4.5h4.2l2 2.5H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2zM12 17.6l-2.9-2.8a1.8 1.8 0 0 1 2.9-2.1 1.8 1.8 0 0 1 2.9 2.1z'] },
  // "Aa".
  formats: { lines: ['M3 19 7.5 5.5 12 19', 'M4.6 14.5h5.8', 'M14 16.2a2.8 2.8 0 1 0 5.6 0 2.8 2.8 0 1 0-5.6 0z', 'M19.6 12.5V19'] },
  // The reader's page view: one page with lines of text, or two pages side by side.
  onePage: {
    fill: ['M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M7 5v14h10V5z', 'M9 8h6v1.6H9z', 'M9 11.2h6v1.6H9z', 'M9 14.4h4v1.6H9z'],
  },
  twoPages: {
    fill: [
      'M3 5h8v14H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
      'M3.8 6.8v10.4h5.4V6.8z',
      'M13 5h8a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-8z',
      'M14.8 6.8v10.4h5.4V6.8z',
      'M5 9h3v1.4H5z',
      'M5 12h3v1.4H5z',
      'M16 9h3v1.4h-3z',
      'M16 12h3v1.4h-3z',
    ],
  },
};

export type IconName = keyof typeof PATHS | ShelfIconName;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  const own = name in SHELF_ICONS ? SHELF_ICONS[name as ShelfIconName] : null;
  return (
    <svg className={className ? `icon ${className}` : 'icon'} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {!own ? (
        <path d={PATHS[name as keyof typeof PATHS]} />
      ) : 'fill' in own ? (
        <path d={own.fill.join('')} fillRule="evenodd" />
      ) : (
        own.lines.map((d) => <path key={d} className="icon-line" d={d} />)
      )}
    </svg>
  );
}
