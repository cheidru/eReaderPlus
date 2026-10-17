import type { EngineInfo } from '../platform';
import { Dialog } from './Dialogs';

interface Props {
  engine: EngineInfo;
  onClose: () => void;
}

export function AboutDialog({ engine, onClose }: Props) {
  return (
    <Dialog
      title="eReaderPlus"
      onClose={onClose}
      actions={
        <button type="button" className="button-text" onClick={onClose}>
          Close
        </button>
      }
    >
      <dl className="about-list">
        <dt>Version</dt>
        <dd>{__APP_VERSION__}</dd>
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
        eReaderPlus was inspired by ReadEra, whose library, shelves and reader it took as a model. The ReadEra color
        theme keeps that look.
      </p>
      <p className="about-note">
        DjVu pages are decoded by DjVu.js (Dmitry Kulikov, GNU GPL 2 or later) and PDF pages by pdf.js (Mozilla, Apache
        License 2.0). CHM files are read with chmlib-ts (GNU LGPL 2.1). The LIT reader is ported from Calibre (Kovid
        Goyal and Marshall T. Vandegrift, GNU GPL 3). MOBI and AZW3 parsing is adapted from foliate-js (John Factotum,
        MIT License).
      </p>
    </Dialog>
  );
}
