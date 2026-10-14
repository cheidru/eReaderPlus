import { splitFragment } from '../../core/paths';
import type { TocItem } from '../../core/types';
import { Icon } from '../icons';
import './Panels.css';

interface Props {
  toc: TocItem[];
  currentHref: string;
  onSelect: (href: string) => void;
  onClose: () => void;
}

export function TocPanel({ toc, currentHref, onSelect, onClose }: Props) {
  return (
    <aside className="panel panel-left" aria-label="Contents">
      <div className="panel-header">
        <h2>Contents</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close contents">
          <Icon name="close" />
        </button>
      </div>
      <div className="panel-body">
        {toc.length === 0 ? <p className="panel-empty">This book has no table of contents.</p> : <TocList items={toc} currentHref={currentHref} onSelect={onSelect} />}
      </div>
    </aside>
  );
}

function TocList({ items, currentHref, onSelect }: { items: TocItem[]; currentHref: string; onSelect: (href: string) => void }) {
  return (
    <ul className="toc-list">
      {items.map((item, i) => (
        <li key={`${item.href}-${i}`}>
          <button
            type="button"
            className={splitFragment(item.href)[0] === currentHref ? 'toc-item toc-current' : 'toc-item'}
            disabled={!item.href}
            onClick={() => onSelect(item.href)}
          >
            {item.label}
          </button>
          {item.children.length > 0 && <TocList items={item.children} currentHref={currentHref} onSelect={onSelect} />}
        </li>
      ))}
    </ul>
  );
}
