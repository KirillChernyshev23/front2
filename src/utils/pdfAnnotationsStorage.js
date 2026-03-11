// src/utils/pdfAnnotationsStorage.js

const STORAGE_PREFIX = "ec_pdf_annotations_v1";

function makeKey(projectId, documentId) {
  return `${STORAGE_PREFIX}:${projectId}:${documentId}`;
}

function safeRead(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Для MVP молча игнорируем ошибки localStorage
  }
}

function normalizeRects(rects) {
  if (!Array.isArray(rects)) return [];

  return rects
    .map((r) => ({
      x: Number(r?.x || 0),
      y: Number(r?.y || 0),
      width: Number(r?.width || 0),
      height: Number(r?.height || 0),
    }))
    .filter((r) => r.width > 0 && r.height > 0);
}

export function loadAnnotations(projectId, documentId) {
  if (!projectId || !documentId) return [];
  return safeRead(makeKey(projectId, documentId));
}

export function addAnnotation(projectId, documentId, payload) {
  const key = makeKey(projectId, documentId);
  const list = safeRead(key);

  const text = String(payload?.text || "").trim();
  const comment = String(payload?.comment || "").trim();
  const rects = normalizeRects(payload?.rects);

  if (!text || !rects.length) return list;

  const nextAnnotation = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    page: Number(payload?.page || 1),
    text,
    comment,
    rects,
    createdAt: new Date().toISOString(),
    documentTitle: String(payload?.documentTitle || ""),
  };

  const nextList = [nextAnnotation, ...list];
  safeWrite(key, nextList);
  return nextList;
}

export function deleteAnnotation(projectId, documentId, annotationId) {
  const key = makeKey(projectId, documentId);
  const list = safeRead(key);
  const nextList = list.filter((item) => item.id !== annotationId);
  safeWrite(key, nextList);
  return nextList;
}