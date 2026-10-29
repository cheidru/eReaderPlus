import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import { clampView, fittedView, panView, shownSize, zoomView, type PictureView, type Size } from '../../core/picture-view';
import { Icon } from '../icons';
import './ImageViewer.css';

interface Props {
  /** The picture's address: of the book's origin, or a data: URL. */
  src: string;
  onClose: () => void;
}

/** A double click on the fitted picture zooms in this far (and on a zoomed one, back out). */
const DOUBLE_CLICK_ZOOM = 2.5;
/** The + and - keys zoom by this much. */
const KEY_ZOOM = 1.25;
/** A pointer that moves farther than this between press and release drags rather than clicks. */
const DRAG_THRESHOLD = 4;

/** Whether an event is on a button: on its icon, too. */
const onButton = (event: { target: EventTarget }) => event.target instanceof Element && event.target.closest('button') !== null;

/**
 * A picture of the book over the whole window, to look at closely: the wheel, a pinch, the + and - keys or a double
 * click zoom it, dragging pans it, and Esc, the close button or a click beside it closes it.
 */
export function ImageViewer({ src, onClose }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const [picture, setPicture] = useState<Size | null>(null);
  const [screen, setScreen] = useState<Size | null>(null);
  const [view, setView] = useState<PictureView>({ zoom: 1, x: 0, y: 0 });
  /** The picture and screen sizes for event handlers, which change the view as they last were. */
  const sizes = useRef({ picture, screen });
  sizes.current = { picture, screen };
  /** Pointers pressed on the viewer, where they last were; two of them pinch. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  /** The press began beside the picture, and has not moved far enough to drag: its click closes the viewer. */
  const press = useRef({ beside: false, dragged: false, x: 0, y: 0 });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  /** Changes the view, once the picture's size is known. */
  const change = (update: (view: PictureView, picture: Size, screen: Size) => PictureView) => {
    const { picture: p, screen: s } = sizes.current;
    if (p && s) setView((v) => update(v, p, s));
  };

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    // The keys go to the viewer, not to the book's frame, which had the focus when the picture was double-clicked.
    el.focus();
    const observer = new ResizeObserver(() => setScreen({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Fitted once the picture's size is known, and kept within bounds when the window is resized.
  const [fitted, setFitted] = useState(false);
  useEffect(() => {
    if (!picture || !screen) return;
    if (!fitted) {
      setView(fittedView(picture, screen));
      setFitted(true);
    } else {
      setView((v) => clampView(v, picture, screen));
    }
  }, [picture, screen, fitted]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    // Not passive: Ctrl+wheel would zoom the whole app.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1);
      const box = el.getBoundingClientRect();
      change((v, p, s) => zoomView(v, Math.exp(-delta * 0.002), event.clientX - box.left, event.clientY - box.top, p, s));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const center = (factor: number) => change((v, p, s) => zoomView(v, factor, s.width / 2, s.height / 2, p, s));
      if (event.key === 'Escape') onCloseRef.current();
      else if (event.key === '+' || event.key === '=') center(KEY_ZOOM);
      else if (event.key === '-') center(1 / KEY_ZOOM);
      else if (event.key === '0') change((_, p, s) => fittedView(p, s));
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const local = (event: { clientX: number; clientY: number }) => {
    const box = stage.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // Capturing a press on the close button would take its click away from it.
    if (onButton(event) || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const at = local(event);
    if (pointers.current.size === 0) press.current = { beside: event.target === event.currentTarget, dragged: false, ...at };
    else press.current.dragged = true;
    pointers.current.set(event.pointerId, at);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const last = pointers.current.get(event.pointerId);
    if (!last) return;
    const at = local(event);
    if (pointers.current.size === 1) {
      if (Math.hypot(at.x - press.current.x, at.y - press.current.y) > DRAG_THRESHOLD) press.current.dragged = true;
      pointers.current.set(event.pointerId, at);
      change((v, p, s) => panView(v, at.x - last.x, at.y - last.y, p, s));
      return;
    }
    // A pinch: the picture follows the middle of the two fingers, and zooms as they spread or close.
    const [a, b] = [...pointers.current.values()];
    const before = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
    pointers.current.set(event.pointerId, at);
    const [c, d] = [...pointers.current.values()];
    const after = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2, distance: Math.hypot(c.x - d.x, c.y - d.y) };
    if (before.distance === 0) return;
    change((v, p, s) => zoomView(panView(v, after.x - before.x, after.y - before.y, p, s), after.distance / before.distance, after.x, after.y, p, s));
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
  };

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (onButton(event)) return;
    if (press.current.beside && !press.current.dragged) onCloseRef.current();
  };

  const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (press.current.dragged) return;
    const at = local(event);
    change((v, p, s) => (v.zoom > 1 ? fittedView(p, s) : zoomView(v, DOUBLE_CLICK_ZOOM, at.x, at.y, p, s)));
  };

  const shown = picture && screen && fitted ? shownSize(view, picture, screen) : null;

  return (
    <div
      ref={stage}
      className="image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="Picture"
      tabIndex={-1}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <img
        className={shown ? 'image-viewer-picture' : 'image-viewer-picture image-viewer-picture-loading'}
        src={src}
        alt=""
        draggable={false}
        onLoad={(event) => {
          // An SVG picture may have no size of its own: it is drawn as large as the screen.
          const { naturalWidth, naturalHeight } = event.currentTarget;
          const box = stage.current!;
          setPicture(naturalWidth > 0 && naturalHeight > 0 ? { width: naturalWidth, height: naturalHeight } : { width: box.clientWidth, height: box.clientHeight });
        }}
        onError={onClose}
        style={
          shown
            ? ({
                '--picture-x': `${view.x}px`,
                '--picture-y': `${view.y}px`,
                '--picture-width': `${shown.width}px`,
                '--picture-height': `${shown.height}px`,
              } as CSSProperties)
            : undefined
        }
      />
      <button type="button" className="icon-button image-viewer-close" onClick={onClose} aria-label="Close picture" title="Close (Esc)">
        <Icon name="close" />
      </button>
    </div>
  );
}
