/**
 * Runs inside every book document (served from the book's own origin, cross-origin to the app).
 * Lays the document out as pages with CSS multi-column, and talks to the app only via postMessage.
 * It has no privileges: anything it does, the book's own scripts could do too.
 */
import { MAX_ZOOM, MESSAGE_TAG, type FrameMessage, type FrameSettings, type GotoTarget, type HostMessage } from '../core/messages';

(() => {
  if (window.parent === window) return;

  const root = document.documentElement;
  root.classList.add('ereader-pending');

  let settings: FrameSettings | null = null;
  let page = 0;
  let pageCount = 1;
  /** Target to re-apply after relayout until the reader moves on (e.g. images loading after a TOC jump). */
  let anchor: GotoTarget | null = null;
  let applyingScroll = false;

  const post = (message: FrameMessage) => window.parent.postMessage({ tag: MESSAGE_TAG, ...message }, '*');

  const mode = (): 'paginated' | 'scrolled' | 'fixed' => {
    if (settings?.layout === 'pre-paginated') return 'fixed';
    return settings?.flow === 'scrolled' ? 'scrolled' : 'paginated';
  };

  const scroller = () => document.scrollingElement ?? root;
  const rtlSign = () => (getComputedStyle(root).direction === 'rtl' ? -1 : 1);

  function currentFraction(): number {
    if (mode() === 'scrolled') {
      const max = scroller().scrollHeight - window.innerHeight;
      return max > 0 ? Math.min(1, scroller().scrollTop / max) : 0;
    }
    return pageCount > 0 ? page / pageCount : 0;
  }

  function report() {
    post({ type: 'relocate', page, pageCount, fraction: currentFraction() });
  }

  function scrollToPage() {
    applyingScroll = true;
    window.scrollTo({ left: rtlSign() * page * window.innerWidth, top: 0, behavior: 'instant' });
    requestAnimationFrame(() => (applyingScroll = false));
  }

  function measure() {
    if (mode() === 'paginated') {
      pageCount = Math.max(1, Math.round(scroller().scrollWidth / window.innerWidth));
    } else {
      pageCount = 1;
    }
  }

  // --- Fixed layout: the page is fitted to the screen, then optionally zoomed and panned ----------

  /**
   * Page box (from the viewport meta), fit-to-screen scale, user zoom on top of it, and which part of a
   * page larger than the screen is shown: 0 = left/top edge, 1 = right/bottom edge.
   */
  const fixed = { width: 0, height: 0, fit: 1, zoom: 1, panX: 0.5, panY: 0 };

  function fitFixedLayout() {
    const viewport = document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '';
    const width = Number(/width\s*=\s*(\d+)/.exec(viewport)?.[1]);
    const height = Number(/height\s*=\s*(\d+)/.exec(viewport)?.[1]);
    const sized = width > 0 && height > 0;
    // A page without a size (comics: an image fitted to the screen) is as large as the screen.
    fixed.width = sized ? width : window.innerWidth;
    fixed.height = sized ? height : window.innerHeight;
    fixed.fit = sized ? Math.min(window.innerWidth / width, window.innerHeight / height) : 1;
    root.style.setProperty('--ereader-fixed-width', `${fixed.width}px`);
    root.style.setProperty('--ereader-fixed-height', `${fixed.height}px`);
    applyFixedView();
    root.classList.add('ereader-fixed-scaled');
  }

  /** Scale, and how far the scaled page sticks out of the screen on each axis (negative: it fits). */
  function fixedGeometry() {
    const scale = fixed.fit * fixed.zoom;
    return { scale, overX: fixed.width * scale - window.innerWidth, overY: fixed.height * scale - window.innerHeight };
  }

  /** Screen offset of the page's top-left corner: centered when it fits, else positioned by `pan`. */
  const fixedOffset = (over: number, pan: number) => (over > 0 ? -over * pan : -over / 2);

  function applyFixedView() {
    const { scale, overX, overY } = fixedGeometry();
    root.style.setProperty('--ereader-fixed-scale', String(scale));
    root.style.setProperty('--ereader-fixed-x', `${fixedOffset(overX, fixed.panX)}px`);
    root.style.setProperty('--ereader-fixed-y', `${fixedOffset(overY, fixed.panY)}px`);
  }

  /** Moves the zoomed page by (dx, dy) screen px. Returns false if it is already at that edge. */
  function panFixed(dx: number, dy: number): boolean {
    const { overX, overY } = fixedGeometry();
    const panX = overX > 0 ? clamp01(fixed.panX - dx / overX) : fixed.panX;
    const panY = overY > 0 ? clamp01(fixed.panY - dy / overY) : fixed.panY;
    if (panX === fixed.panX && panY === fixed.panY) return false;
    fixed.panX = panX;
    fixed.panY = panY;
    applyFixedView();
    queueZoomReport(false);
    return true;
  }

  /** Multiplies the zoom by `factor`, keeping the page point under screen point (x, y) in place. */
  function zoomFixed(factor: number, x: number, y: number) {
    if (!fixed.width) return;
    const before = fixedGeometry();
    const pageX = (x - fixedOffset(before.overX, fixed.panX)) / before.scale;
    const pageY = (y - fixedOffset(before.overY, fixed.panY)) / before.scale;
    const zoom = Math.min(MAX_ZOOM, Math.max(1, fixed.zoom * factor));
    if (zoom === fixed.zoom) return;
    fixed.zoom = zoom;
    const after = fixedGeometry();
    if (after.overX > 0) fixed.panX = clamp01((pageX * after.scale - x) / after.overX);
    if (after.overY > 0) fixed.panY = clamp01((pageY * after.scale - y) / after.overY);
    applyFixedView();
    queueZoomReport(true);
  }

  /** Whether the page can't move any further when dragged or scrolled to show more towards (dirX, dirY). */
  function fixedAtEdge(dirX: number, dirY: number): boolean {
    const { overX, overY } = fixedGeometry();
    const stuck = (over: number, pan: number, dir: number) => dir === 0 || over <= 0 || (dir > 0 ? pan >= 1 : pan <= 0);
    return stuck(overX, fixed.panX, dirX) && stuck(overY, fixed.panY, dirY);
  }

  let zoomReportTimer: number | undefined;
  let zoomChanged = false;
  /**
   * Once zooming or panning pauses, tells the app (which keeps the zoom for the next page) and the page
   * renderers (PDF, DjVu), which redraw at the new resolution on `ereader:zoom`.
   */
  function queueZoomReport(zoomed: boolean) {
    zoomChanged ||= zoomed;
    window.clearTimeout(zoomReportTimer);
    zoomReportTimer = window.setTimeout(() => {
      post({ type: 'zoom', zoom: fixed.zoom, panX: fixed.panX });
      if (zoomChanged) announceZoom();
      zoomChanged = false;
    }, 200);
  }

  function announceZoom() {
    root.dataset.ereaderZoom = String(fixed.zoom);
    window.dispatchEvent(new Event('ereader:zoom'));
  }

  function setFixedZoom(zoom: number, panX: number) {
    fixed.zoom = Math.min(MAX_ZOOM, Math.max(1, zoom));
    fixed.panX = clamp01(panX);
    if (mode() === 'fixed') applyFixedView();
    announceZoom();
  }

  function goto(target: GotoTarget) {
    const m = mode();
    if (m === 'fixed') {
      // Arriving from the next page shows the bottom of a zoomed page, as if scrolling back up to it.
      fixed.panY = target.kind === 'end' ? 1 : 0;
      applyFixedView();
      report();
      return;
    }
    if (target.kind === 'fragment') {
      const id = safeDecode(target.value);
      const el = document.getElementById(id) ?? document.getElementsByName(id)[0];
      if (!el) return goto({ kind: 'fraction', value: 0 });
      if (m === 'scrolled') {
        el.scrollIntoView({ block: 'start', behavior: 'instant' });
      } else {
        const x = el.getBoundingClientRect().left + window.scrollX;
        const w = window.innerWidth;
        page = clamp(rtlSign() === 1 ? Math.floor((x + 1) / w) : Math.ceil((-x - 1) / w));
        scrollToPage();
      }
    } else if (m === 'scrolled') {
      const max = scroller().scrollHeight - window.innerHeight;
      const top = target.kind === 'end' ? max : target.kind === 'fraction' ? target.value * max : target.value * window.innerHeight;
      window.scrollTo({ top, left: 0, behavior: 'instant' });
    } else {
      page =
        target.kind === 'end' ? pageCount - 1 : target.kind === 'page' ? target.value : Math.floor(target.value * pageCount + 1e-6);
      page = clamp(page);
      scrollToPage();
    }
    report();
  }

  function clamp(p: number): number {
    return Math.min(Math.max(0, p), pageCount - 1);
  }

  function clamp01(v: number): number {
    return Math.min(Math.max(0, v), 1);
  }

  function relayout() {
    if (!settings) return;
    if (mode() === 'fixed') {
      // Keeps the zoom and the part of the page shown (goto would return to the top).
      fitFixedLayout();
      measure();
      return report();
    }
    const keep: GotoTarget = anchor ?? { kind: 'fraction', value: currentFraction() };
    measure();
    goto(keep);
  }

  function turn(dir: 1 | -1) {
    anchor = null;
    const m = mode();
    if (m === 'paginated') {
      const next = page + dir;
      if (next < 0 || next >= pageCount) return post({ type: 'edge', dir });
      page = next;
      scrollToPage();
      report();
    } else if (m === 'scrolled') {
      const el = scroller();
      const atEnd = dir === 1 ? el.scrollTop + window.innerHeight >= el.scrollHeight - 2 : el.scrollTop <= 0;
      if (atEnd) return post({ type: 'edge', dir });
      window.scrollBy({ top: dir * (window.innerHeight - 48), behavior: 'smooth' });
    } else {
      post({ type: 'edge', dir });
    }
  }

  function applySettings(next: FrameSettings) {
    const fraction = settings ? currentFraction() : 0;
    settings = next;
    const m = mode();
    root.classList.toggle('ereader-paginated', m === 'paginated');
    root.classList.toggle('ereader-scrolled', m === 'scrolled');
    root.classList.toggle('ereader-fixed', m === 'fixed');
    root.classList.toggle('ereader-override', next.overrideStyles);
    root.classList.toggle('ereader-custom-font', next.overrideStyles && next.fontFamily !== '');
    root.classList.toggle('ereader-custom-line-height', next.overrideStyles && next.lineHeight > 0);
    root.dataset.ereaderTheme = next.theme;
    root.style.setProperty('--ereader-margin', `${next.margin}px`);
    root.style.setProperty('--ereader-font-scale', String(next.fontScale / 100));
    root.style.setProperty('--ereader-font-family', next.fontFamily || 'inherit');
    root.style.setProperty('--ereader-line-height', String(next.lineHeight || 'normal'));
    root.classList.remove('ereader-pending');
    if (anchor === null) anchor = { kind: 'fraction', value: fraction };
    relayout();
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const data = event.data as HostMessage;
    if (typeof data !== 'object' || data === null || data.tag !== MESSAGE_TAG) return;
    if (data.type === 'settings') applySettings(data.settings);
    else if (data.type === 'goto') {
      anchor = data.target;
      goto(data.target);
    } else if (data.type === 'turn') turn(data.dir);
    else if (data.type === 'zoom' && Number.isFinite(data.zoom) && Number.isFinite(data.panX)) setFixedZoom(data.zoom, data.panX);
  });

  // --- Layout tracking -------------------------------------------------------------------------

  let relayoutQueued = false;
  const queueRelayout = () => {
    if (relayoutQueued) return;
    relayoutQueued = true;
    requestAnimationFrame(() => {
      relayoutQueued = false;
      relayout();
    });
  };

  window.addEventListener('resize', queueRelayout);
  window.addEventListener('load', queueRelayout);
  document.fonts?.ready.then(queueRelayout);

  window.addEventListener(
    'scroll',
    () => {
      if (!settings || applyingScroll) return;
      if (mode() === 'paginated') {
        // Focus, find-in-page or book scripts can scroll to an unaligned offset: snap to a page.
        const p = clamp(Math.round((rtlSign() * window.scrollX) / window.innerWidth));
        if (p !== page || Math.abs(window.scrollX - rtlSign() * p * window.innerWidth) > 1) {
          page = p;
          scrollToPage();
          report();
        }
      } else if (mode() === 'scrolled') {
        anchor = null;
        report();
      } else if (window.scrollX || window.scrollY) {
        // A zoomed fixed page sticks out of the screen, so focus or find-in-page can scroll it; we pan instead.
        scrollToPage();
      }
    },
    { passive: true },
  );

  // --- Input -----------------------------------------------------------------------------------

  const INTERACTIVE = 'a,button,input,select,textarea,label,summary,video,audio,[contenteditable],[role="button"],[tabindex]';
  const isEditable = (el: EventTarget | null) => el instanceof Element && el.closest('input,textarea,select,[contenteditable]') !== null;

  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isEditable(event.target)) return;
    const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === ' ';
    if (mode() === 'scrolled' && vertical) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', ' ', 'Home', 'End', 'Escape'].includes(event.key)) {
      event.preventDefault();
      post({ type: 'key', key: event.key });
    }
  });

  /**
   * Scrolling a chapter or a zoomed page stops at its edge; only a new wheel gesture (after a pause, so not
   * the rest of a spin or of touchpad inertia) goes on to the next page.
   */
  let lastWheel = -Infinity;
  const EDGE_PAUSE_MS = 300;
  let textZoomDelta = 0;
  let lastTextZoom = -Infinity;

  /** Ctrl+wheel on reflowable text (also a touchpad pinch, which Chromium reports as one) changes the font size. */
  function wheelTextZoom(event: WheelEvent) {
    if (event.timeStamp - lastTextZoom > 500) textZoomDelta = 0;
    lastTextZoom = event.timeStamp;
    textZoomDelta += event.deltaY;
    if (Math.abs(textZoomDelta) < 50) return;
    post({ type: 'textzoom', dir: textZoomDelta < 0 ? 1 : -1 });
    textZoomDelta = 0;
  }

  window.addEventListener(
    'wheel',
    (event) => {
      if (event.defaultPrevented || !settings) return;
      const m = mode();
      if (event.ctrlKey) {
        event.preventDefault();
        if (m === 'fixed') zoomFixed(Math.exp(-event.deltaY * 0.0025), event.clientX, event.clientY);
        else wheelTextZoom(event);
        return;
      }
      const newGesture = event.timeStamp - lastWheel > EDGE_PAUSE_MS;
      lastWheel = event.timeStamp;
      if (m === 'scrolled') {
        // Scrolls natively; past the end (start) of the chapter, moves on to the next (previous) one.
        if (event.deltaY === 0) return;
        const el = scroller();
        const atEdge = event.deltaY > 0 ? el.scrollTop + window.innerHeight >= el.scrollHeight - 2 : el.scrollTop <= 0;
        if (!atEdge) return;
        event.preventDefault();
        if (newGesture) post({ type: 'wheel', delta: event.deltaY });
        return;
      }
      event.preventDefault();
      // A zoomed page scrolls first (Shift+wheel or a touchpad: sideways).
      if (m === 'fixed' && fixed.zoom > 1 && (panFixed(-event.deltaX, -event.deltaY) || !newGesture)) return;
      post({ type: 'wheel', delta: Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX });
    },
    { passive: false },
  );

  // Touch: swipes turn pages (sideways in the reading direction, or up and down like scrolling), a pinch
  // zooms a fixed-layout page or changes the font size, and one finger pans a zoomed page.
  // touch-action in paginator.css keeps the browser's own pinch zoom (and, on fixed pages, panning) out.

  let pointerStart: { x: number; y: number } | null = null;
  window.addEventListener('pointerdown', (event) => {
    pointerStart = event.isPrimary ? { x: event.clientX, y: event.clientY } : null;
  });

  interface Swipe {
    x: number;
    y: number;
    time: number;
    lastX: number;
    lastY: number;
    /** Scrolled mode: whether the chapter was scrolled to its top / bottom when the touch began. */
    atTop: boolean;
    atBottom: boolean;
    /** Fixed mode: whether a zoomed page could not pan any further, per swipe direction, when the touch began. */
    stuckLeft: boolean;
    stuckRight: boolean;
    stuckUp: boolean;
    stuckDown: boolean;
  }
  let swipe: Swipe | null = null;
  /** Finger distance and center at the last move; `textBase` is the distance at the last font size step. */
  let pinch: { distance: number; x: number; y: number; textBase: number } | null = null;

  const touchDistance = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const touchCenter = (t: TouchList) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });

  window.addEventListener(
    'touchstart',
    (event) => {
      const touches = event.touches;
      if (touches.length === 1 && !pinch) {
        const { clientX: x, clientY: y } = touches[0];
        const el = scroller();
        swipe = {
          x,
          y,
          time: event.timeStamp,
          lastX: x,
          lastY: y,
          atTop: el.scrollTop <= 0,
          atBottom: el.scrollTop + window.innerHeight >= el.scrollHeight - 2,
          // Swiping left drags the page left, revealing its right side.
          stuckLeft: fixedAtEdge(1, 0),
          stuckRight: fixedAtEdge(-1, 0),
          stuckUp: fixedAtEdge(0, 1),
          stuckDown: fixedAtEdge(0, -1),
        };
      } else if (touches.length === 2) {
        swipe = null;
        const distance = touchDistance(touches);
        pinch = { distance, ...touchCenter(touches), textBase: distance };
      }
    },
    { passive: true },
  );

  window.addEventListener(
    'touchmove',
    (event) => {
      const touches = event.touches;
      const m = mode();
      if (pinch && touches.length === 2) {
        const distance = touchDistance(touches);
        const center = touchCenter(touches);
        if (m === 'fixed') {
          panFixed(center.x - pinch.x, center.y - pinch.y);
          if (pinch.distance > 0) zoomFixed(distance / pinch.distance, center.x, center.y);
        } else if (pinch.textBase > 0 && (distance / pinch.textBase > 1.25 || distance / pinch.textBase < 0.8)) {
          post({ type: 'textzoom', dir: distance > pinch.textBase ? 1 : -1 });
          pinch.textBase = distance;
        }
        pinch.distance = distance;
        pinch.x = center.x;
        pinch.y = center.y;
      } else if (swipe && touches.length === 1 && m === 'fixed' && fixed.zoom > 1) {
        const { clientX: x, clientY: y } = touches[0];
        panFixed(x - swipe.lastX, y - swipe.lastY);
        swipe.lastX = x;
        swipe.lastY = y;
      }
    },
    { passive: true },
  );

  window.addEventListener('touchend', (event) => {
    if (pinch) {
      // Lifting the fingers of a pinch one by one must not end in a swipe or pan.
      if (event.touches.length === 0) pinch = null;
      return;
    }
    const start = swipe;
    swipe = null;
    const touch = event.changedTouches[0];
    if (!start || !touch || event.touches.length > 0 || event.timeStamp - start.time > 800) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const horizontal = Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5;
    const vertical = Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx) * 1.5;
    if (!horizontal && !vertical) return;
    const m = mode();
    if (m === 'scrolled') {
      // Swiping on past the end (start) of the chapter moves to the next (previous) one.
      if (vertical && (dy < 0 ? start.atBottom : start.atTop)) turn(dy < 0 ? 1 : -1);
      return;
    }
    if (m === 'fixed' && fixed.zoom > 1) {
      // A zoomed page turns only when the swipe could not pan it any further.
      const stuck = horizontal ? (dx < 0 ? start.stuckLeft : start.stuckRight) : dy < 0 ? start.stuckUp : start.stuckDown;
      if (!stuck) return;
    }
    if (horizontal) post({ type: 'swipe', dir: dx < 0 ? 1 : -1 });
    else turn(dy < 0 ? 1 : -1);
  });

  window.addEventListener('touchcancel', () => {
    swipe = null;
    pinch = null;
  });

  window.addEventListener('click', (event) => {
    const start = pointerStart;
    pointerStart = null;
    if (event.defaultPrevented || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;

    const link = target?.closest('a[href]') as HTMLAnchorElement | SVGAElement | null;
    if (link) return handleLink(event, link);

    if (target?.closest(INTERACTIVE)) return;
    if (!document.getSelection()?.isCollapsed) return;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) return;
    post({ type: 'tap', x: event.clientX / window.innerWidth, y: event.clientY / window.innerHeight });
  });

  function handleLink(event: MouseEvent, link: HTMLAnchorElement | SVGAElement) {
    const raw = link instanceof SVGAElement ? link.href.baseVal : link.getAttribute('href') ?? '';
    let url: URL;
    try {
      url = new URL(raw, location.href);
    } catch {
      return;
    }
    if (url.protocol === 'javascript:') return;
    event.preventDefault();
    if (url.origin === location.origin) {
      if (url.pathname === location.pathname && url.hash) {
        anchor = { kind: 'fragment', value: url.hash.slice(1) };
        goto(anchor);
      } else {
        post({ type: 'link', href: safeDecode(url.pathname.slice(1)) + url.hash });
      }
    } else if (/^(https?|mailto):$/.test(url.protocol)) {
      post({ type: 'external', href: url.href });
    }
  }

  function safeDecode(s: string): string {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => post({ type: 'ready' }), { once: true });
  } else {
    post({ type: 'ready' });
  }
})();
