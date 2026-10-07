/** pdf.js setup shared by PDF import (app) and PDF page documents (book frames). */
import type * as PdfJs from 'pdfjs-dist';

/** Where scripts/build-inject.mjs puts the pdf.js build and its data files, on every origin. */
export const PDFJS_DIR = '/__ereader__/pdfjs/';
export const PDFJS_MODULE = `${PDFJS_DIR}pdf.min.mjs`;
export const PDFJS_WORKER = `${PDFJS_DIR}pdf.worker.min.mjs`;

/** pdf.js renders 1 PDF point as 1 px at scale 1; CSS has 96 px per 72 pt. */
export const CSS_PX_PER_PT = 96 / 72;

export function pdfDocumentOptions() {
  return {
    cMapUrl: `${PDFJS_DIR}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_DIR}standard_fonts/`,
    wasmUrl: `${PDFJS_DIR}wasm/`,
    iccUrl: `${PDFJS_DIR}iccs/`,
  };
}

/** Page index (0-based) of an outline or link destination, or null. */
export async function destinationPage(doc: PdfJs.PDFDocumentProxy, dest: unknown): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || explicit.length === 0) return null;
    const target = explicit[0];
    if (typeof target === 'number') return target;
    if (target && typeof target === 'object') return await doc.getPageIndex(target as Parameters<PdfJs.PDFDocumentProxy['getPageIndex']>[0]);
  } catch {
    // Broken destinations are common; they just don't link anywhere.
  }
  return null;
}
