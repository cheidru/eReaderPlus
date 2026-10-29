import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { formatLabel, isFilterActive } from '../core/shelves';
import { ALL_FORMATS, type BookFormat, type LibraryFilter } from '../core/types';
import { GalaxySpinner } from './GalaxySpinner';
import { Icon } from './icons';
import './Dialogs.css';

/** Closes on Escape. Every dialog and menu has exactly one way out that works from the keyboard. */
function useEscape(onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function Dialog({ title, onClose, children, actions, className }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input, button:not(.dialog-close)')?.focus();
  }, []);
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div ref={ref} className={className ? `dialog ${className}` : 'dialog'} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2 className="dialog-title">{title}</h2>
        <div className="dialog-body">{children}</div>
        {actions && <div className="dialog-actions">{actions}</div>}
      </div>
    </div>
  );
}

/** Asked once, on the first run on Android: books are found in the device's folders only with this permission. */
export function FolderAccessDialog({ onAllow, onClose }: { onAllow: () => void; onClose: () => void }) {
  return (
    <Dialog
      title="Allow access to your files"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="button-text" onClick={onClose}>
            Not now
          </button>
          <button
            type="button"
            className="button-text"
            onClick={() => {
              onAllow();
              onClose();
            }}
          >
            Allow access
          </button>
        </>
      }
    >
      <p className="dialog-message">eReaderPlus needs permission to read the files on this device to show your book folders and add the books in them.</p>
      <p className="dialog-message">Android lists this as “All files access”. Turn it on for eReaderPlus, then come back.</p>
    </Dialog>
  );
}

/**
 * Shown while the reader waits for a book still being imported: its book opens by itself once it is ready.
 * Going back leaves the import running; the book stays in the library.
 */
export function BookWaitDialog({ title, onClose }: { title: string; onClose: () => void }) {
  useEscape(onClose);
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="book-wait" role="dialog" aria-modal="true" aria-label={`Opening ${title}`} onClick={(e) => e.stopPropagation()}>
        <GalaxySpinner />
        <div className="book-wait-text" role="status">
          <span className="book-wait-title">{title}</span>
          <span>Getting the book ready…</span>
        </div>
        <button type="button" className="button-text book-wait-back" onClick={onClose} autoFocus>
          Back to library
        </button>
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onClose }: { title: string; message: string; confirmLabel: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="button-text" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button-text button-danger"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="dialog-message">{message}</p>
    </Dialog>
  );
}

export function PromptDialog({ title, label, confirmLabel, onSubmit, onClose }: { title: string; label: string; confirmLabel: string; onSubmit: (value: string) => void; onClose: () => void }) {
  const [value, setValue] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) return;
    onSubmit(value.trim());
    onClose();
  };
  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit}>
        <input className="text-field" value={value} onChange={(e) => setValue(e.target.value)} aria-label={label} placeholder={label} />
        <div className="dialog-actions">
          <button type="button" className="button-text" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button-text" disabled={!value.trim()}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

interface CollectionsDialogProps {
  bookTitle: string;
  names: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
}

/** Puts one book into collections, and creates new collections on the way. */
export function CollectionsDialog({ bookTitle, names, selected, onChange, onCreate, onClose }: CollectionsDialogProps) {
  const [newName, setNewName] = useState('');
  const toggle = (name: string) => onChange(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name]);
  const create = (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (!names.includes(name)) onCreate(name);
    if (!selected.includes(name)) onChange([...selected, name]);
    setNewName('');
  };
  return (
    <Dialog
      title="Collections"
      onClose={onClose}
      actions={
        <button type="button" className="button-text" onClick={onClose}>
          Done
        </button>
      }
    >
      <p className="dialog-subtitle">{bookTitle}</p>
      {names.length > 0 && (
        <ul className="check-list">
          {names.map((name) => (
            <li key={name}>
              <label className="check-row">
                <input type="checkbox" checked={selected.includes(name)} onChange={() => toggle(name)} />
                <Icon name="collections" />
                <span>{name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <form className="inline-form" onSubmit={create}>
        <input className="text-field" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New collection" aria-label="New collection name" />
        <button type="submit" className="icon-button" disabled={!newName.trim()} aria-label="Create collection">
          <Icon name="addCircle" />
        </button>
      </form>
    </Dialog>
  );
}

interface FilterDialogProps {
  filter: LibraryFilter;
  /** How many books the shelf would show with a filter, for the live count. */
  countFor: (filter: LibraryFilter) => number;
  onApply: (filter: LibraryFilter) => void;
  onClose: () => void;
}

export function FilterDialog({ filter, countFor, onApply, onClose }: FilterDialogProps) {
  const [draft, setDraft] = useState(filter);
  // Picking a format here also ends "no formats" (Formats page), which would otherwise still hide every book.
  const toggleFormat = (format: BookFormat) =>
    setDraft({ formats: draft.formats.includes(format) ? draft.formats.filter((f) => f !== format) : [...draft.formats, format], hideFinished: draft.hideFinished });
  return (
    <Dialog title="Filter" onClose={onClose} className="filter-dialog">
      <div className="chips" role="group" aria-label="Formats">
        {ALL_FORMATS.map((format) => (
          <button key={format} type="button" className="chip" aria-pressed={draft.formats.includes(format)} onClick={() => toggleFormat(format)}>
            {formatLabel(format)}
          </button>
        ))}
      </div>
      <div className="chips chips-separated">
        <button type="button" className="chip" aria-pressed={draft.hideFinished} onClick={() => setDraft({ ...draft, hideFinished: !draft.hideFinished })}>
          Hide finished
        </button>
      </div>
      <div className="dialog-actions filter-actions">
        <span className="filter-count" aria-live="polite">
          {countFor(draft)}
        </span>
        {isFilterActive(draft) && (
          <button type="button" className="button-text" onClick={() => setDraft({ formats: [], hideFinished: false })}>
            Clear
          </button>
        )}
        <button type="button" className="button-text" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="button-text"
          onClick={() => {
            onApply(draft);
            onClose();
          }}
        >
          Apply
        </button>
      </div>
    </Dialog>
  );
}

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** Shown as a radio button (or a checkbox): true selected, false unselected, undefined none. */
  checked?: boolean;
  /** `checked` is shown as a checkbox, and ticking it keeps the menu open to tick more. */
  checkbox?: boolean;
  /** The item opens more items instead of closing the menu. */
  submenu?: boolean;
  danger?: boolean;
}

/** The button that opened a menu, or the point right-clicked. */
export type MenuAnchor = HTMLElement | { x: number; y: number };

interface PopupMenuProps {
  /** The button that opened the menu, which opens over its corner like an Android overflow menu; or a point, where it opens like a context menu. */
  anchor: MenuAnchor;
  title?: string;
  items: MenuItem[];
  /** A detail shown under the title, such as where the book's file is. */
  note?: { label: string; text: string };
  /** Opens under the button, as a drop-down list, rather than over it. */
  dropdown?: boolean;
  onClose: () => void;
}

export function PopupMenu({ anchor, title, items, note, dropdown, onClose }: PopupMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  useEscape(onClose);

  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const m = menu.getBoundingClientRect();
    const margin = 8;
    const fit = (at: number, size: number, room: number) => Math.max(margin, Math.min(at, room - size - margin));
    if (!(anchor instanceof HTMLElement)) {
      setPosition({ top: fit(anchor.y, m.height, window.innerHeight), left: fit(anchor.x, m.width, window.innerWidth) });
      return;
    }
    const a = anchor.getBoundingClientRect();
    setPosition({ top: fit(dropdown ? a.bottom + 4 : a.top, m.height, window.innerHeight), left: fit(a.right - m.width, m.width, window.innerWidth) });
  }, [anchor, items, title, note, dropdown]);

  // Focus goes to the first item when the menu opens or moves to a submenu, not when a ticked item updates it.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
  }, [title]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const all = [...(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    const index = all.indexOf(document.activeElement as HTMLElement);
    all[(index + (event.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
  };

  return (
    <div className="menu-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className="menu"
        role="menu"
        aria-label={title}
        style={position ? { top: position.top, left: position.left } : { visibility: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {title && <div className="menu-title">{title}</div>}
        {note && (
          <div className="menu-note">
            <span className="menu-note-label">{note.label}</span>
            <span className="menu-note-text">{note.text}</span>
          </div>
        )}
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role={item.checked === undefined ? 'menuitem' : item.checkbox ? 'menuitemcheckbox' : 'menuitemradio'}
            aria-checked={item.checked}
            className={item.danger ? 'menu-item menu-item-danger' : 'menu-item'}
            onClick={() => {
              item.onSelect();
              if (!item.submenu && !item.checkbox) onClose();
            }}
          >
            <span>{item.label}</span>
            {item.checked !== undefined && (item.checkbox ? <Checkbox on={item.checked} /> : <span className={item.checked ? 'radio radio-on' : 'radio'} aria-hidden="true" />)}
            {item.submenu && <Icon name="chevronRight" className="menu-arrow" />}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Checkbox({ on }: { on: boolean }) {
  return (
    <span className={on ? 'checkbox checkbox-on' : 'checkbox'} aria-hidden="true">
      {on && <Icon name="check" />}
    </span>
  );
}
