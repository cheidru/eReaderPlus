/**
 * Geometry of the picture viewer (ImageViewer.tsx): a picture of the book fitted to the screen, zoomed on top of that
 * and panned. Sizes and positions are in screen (CSS) px.
 */

/** Largest magnification, on top of fitting the picture to the screen. */
export const MAX_PICTURE_ZOOM = 8;

/** A small picture is enlarged to fit the screen, but no more than this. */
const MAX_FIT_ENLARGEMENT = 4;

export interface Size {
  width: number;
  height: number;
}

/** The magnification on top of fitting the picture to the screen (1: fitted), and where its top-left corner is. */
export interface PictureView {
  zoom: number;
  x: number;
  y: number;
}

/** The scale at which the whole picture fits the screen. */
export function fitScale(picture: Size, screen: Size): number {
  return Math.min(screen.width / picture.width, screen.height / picture.height, MAX_FIT_ENLARGEMENT);
}

/** The picture's size on screen. */
export function shownSize(view: PictureView, picture: Size, screen: Size): Size {
  const scale = fitScale(picture, screen) * view.zoom;
  return { width: picture.width * scale, height: picture.height * scale };
}

/**
 * The view brought within bounds: the zoom between fitted and the largest, and on each axis the picture centered where
 * it is smaller than the screen, else covering the screen (it can't be dragged away from an edge).
 */
export function clampView(view: PictureView, picture: Size, screen: Size): PictureView {
  const zoom = Math.min(MAX_PICTURE_ZOOM, Math.max(1, view.zoom));
  const shown = shownSize({ ...view, zoom }, picture, screen);
  const place = (at: number, length: number, room: number) => (length <= room ? (room - length) / 2 : Math.min(0, Math.max(room - length, at)));
  return { zoom, x: place(view.x, shown.width, screen.width), y: place(view.y, shown.height, screen.height) };
}

/** The whole picture, fitted to the screen and centered. */
export function fittedView(picture: Size, screen: Size): PictureView {
  return clampView({ zoom: 1, x: 0, y: 0 }, picture, screen);
}

/** Zooms by `factor`, keeping the point of the picture under screen point (atX, atY) where it is. */
export function zoomView(view: PictureView, factor: number, atX: number, atY: number, picture: Size, screen: Size): PictureView {
  const zoom = Math.min(MAX_PICTURE_ZOOM, Math.max(1, view.zoom * factor));
  const ratio = zoom / view.zoom;
  return clampView({ zoom, x: atX - (atX - view.x) * ratio, y: atY - (atY - view.y) * ratio }, picture, screen);
}

/** Moves the picture by (dx, dy). */
export function panView(view: PictureView, dx: number, dy: number, picture: Size, screen: Size): PictureView {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy }, picture, screen);
}
