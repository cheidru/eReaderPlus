import type { EngineInfo } from '../platform';
import './AboutDialog.css';

interface Props {
  engine: EngineInfo;
  onClose: () => void;
}

export function AboutDialog({ engine, onClose }: Props) {
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-label="About eReaderPlus" onClick={(e) => e.stopPropagation()}>
        <h2>eReaderPlus</h2>
        <dl className="about-list">
          <dt>Rendering engine</dt>
          <dd>
            {engine.engine} {engine.version}
          </dd>
          <dt>App shell</dt>
          <dd>{engine.shell}</dd>
        </dl>
        <p className="about-note">
          {engine.updateUrl
            ? 'The engine is updated by the system through the Play Store.'
            : 'The engine ships with the app; app updates bring new Chromium versions.'}
        </p>
        <p className="about-note">
          DjVu pages are decoded by DjVu.js (Dmitry Kulikov, GNU GPL 2 or later) and PDF pages by pdf.js (Mozilla, Apache
          License 2.0). CHM files are read with chmlib-ts (GNU LGPL 2.1). The LIT reader is ported from Calibre (Kovid
          Goyal and Marshall T. Vandegrift, GNU GPL 3). MOBI and AZW3 parsing is adapted from foliate-js (John Factotum,
          MIT License).
        </p>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
