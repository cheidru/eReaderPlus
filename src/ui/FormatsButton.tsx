import { useState } from 'react';
import { allFormatsShown, formatLabel, isFormatShown, toggleAllFormats, toggleFormat } from '../core/shelves';
import { ALL_FORMATS, type LibraryFilter } from '../core/types';
import { PopupMenu, type MenuItem } from './Dialogs';
import { Icon } from './icons';

/** The formats shown, ticked in a drop-down from the bar of every page but the reader; the same choice as the Formats shelf. */
export function FormatsButton({ filter, onChange }: { filter: LibraryFilter; onChange: (filter: LibraryFilter) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const all = allFormatsShown(filter);
  const items: MenuItem[] = [
    { label: 'All formats', checkbox: true, checked: all, onSelect: () => onChange(toggleAllFormats(filter)) },
    ...ALL_FORMATS.map((format) => ({
      label: formatLabel(format),
      checkbox: true,
      checked: isFormatShown(filter, format),
      onSelect: () => onChange(toggleFormat(filter, format)),
    })),
  ];
  const label = all ? 'Formats shown' : 'Formats shown (some are hidden)';
  return (
    <>
      <button
        type="button"
        className={all ? 'icon-button formats-button' : 'icon-button formats-button formats-button-filtered'}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        <Icon name="formats" />
      </button>
      {anchor && <PopupMenu anchor={anchor} title="Formats shown" items={items} dropdown onClose={() => setAnchor(null)} />}
    </>
  );
}
