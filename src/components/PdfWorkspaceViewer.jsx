// src/components/PdfWorkspaceViewer.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import {
  addAnnotation,
  deleteAnnotation,
  loadAnnotations,
} from "../utils/pdfAnnotationsStorage";


pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatDateTime(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  return d.toLocaleString();
}

function getClosestPageElement(node) {
  let current = node;

  while (current) {
    if (current.dataset?.pageNumber) return current;
    current = current.parentElement;
  }

  return null;
}

function normalizeRects(rects, pageRect) {
  return rects
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({
      x: (r.left - pageRect.left) / pageRect.width,
      y: (r.top - pageRect.top) / pageRect.height,
      width: r.width / pageRect.width,
      height: r.height / pageRect.height,
    }))
    .filter(
      (r) =>
        Number.isFinite(r.x) &&
        Number.isFinite(r.y) &&
        Number.isFinite(r.width) &&
        Number.isFinite(r.height)
    );
}

export default function PdfWorkspaceViewer({
  fileUrl,
  projectId,
  documentId,
  documentTitle,
  loading,
  error,
  onDownload,
}) {
  const scrollRef = useRef(null);
  const pageRefs = useRef({});
  const flashTimerRef = useRef(null);

  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.15);
  const [viewerError, setViewerError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  // Текущее выделение, которое пользователь ещё не сохранил
  const [selectionText, setSelectionText] = useState("");
  const [selectionPage, setSelectionPage] = useState(1);
  const [selectionRects, setSelectionRects] = useState([]);
  const [selectionComment, setSelectionComment] = useState("");
  const [selectionWarning, setSelectionWarning] = useState("");

  // Сохранённые аннотации по текущему документу
  const [annotations, setAnnotations] = useState([]);

  // Для "мигания" активной подсветки после перехода по ярлыку
  const [flashAnnotationId, setFlashAnnotationId] = useState(null);

  useEffect(() => {
    setNumPages(0);
    setViewerError("");
    setCurrentPage(1);
    setSelectionText("");
    setSelectionPage(1);
    setSelectionRects([]);
    setSelectionComment("");
    setSelectionWarning("");
    setFlashAnnotationId(null);
    pageRefs.current = {};
  }, [fileUrl, documentId]);

  useEffect(() => {
    setAnnotations(loadAnnotations(projectId, documentId));
  }, [projectId, documentId]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) {
        clearTimeout(flashTimerRef.current);
      }
    };
  }, []);

  const annotationsByPage = useMemo(() => {
    const map = new Map();

    for (const ann of annotations) {
      const page = Number(ann.page || 1);
      if (!map.has(page)) map.set(page, []);
      map.get(page).push(ann);
    }

    return map;
  }, [annotations]);

  function handleDocumentLoadSuccess({ numPages: loadedPages }) {
    setNumPages(loadedPages);
    setCurrentPage(1);
    setViewerError("");
  }

  function handleDocumentLoadError(err) {
    setViewerError(err?.message || "Не удалось открыть PDF");
  }

  function handleScroll() {
    const container = scrollRef.current;
    if (!container || !numPages) return;

    const scrollTop = container.scrollTop;
    let bestPage = 1;
    let bestDistance = Infinity;

    for (let page = 1; page <= numPages; page += 1) {
      const el = pageRefs.current[page];
      if (!el) continue;

      const distance = Math.abs(el.offsetTop - scrollTop);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPage = page;
      }
    }

    setCurrentPage(bestPage);
  }

  function clearSelectionState() {
    setSelectionText("");
    setSelectionRects([]);
    setSelectionComment("");
    setSelectionWarning("");

    const selection = window.getSelection();
    if (selection) selection.removeAllRanges();
  }

  function handleMouseUp() {
    const selection = window.getSelection();
    const text = selection?.toString()?.trim() || "";

    if (!text) {
      setSelectionText("");
      setSelectionRects([]);
      setSelectionWarning("");
      return;
    }

    const container = scrollRef.current;
    if (!container) return;

    if (!selection.rangeCount) return;
    const range = selection.getRangeAt(0);

    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;

    const anchorEl =
      anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement;
    const focusEl =
      focusNode instanceof Element ? focusNode : focusNode?.parentElement;

    const insideAnchor = anchorEl ? container.contains(anchorEl) : false;
    const insideFocus = focusEl ? container.contains(focusEl) : false;

    if (!insideAnchor || !insideFocus) return;

    const anchorPageEl = getClosestPageElement(anchorEl);
    const focusPageEl = getClosestPageElement(focusEl);

    if (!anchorPageEl || !focusPageEl) return;

    const anchorPage = Number(anchorPageEl.dataset.pageNumber);
    const focusPage = Number(focusPageEl.dataset.pageNumber);

    // Для первого рабочего варианта поддерживаем только выделение в пределах одной страницы.
    if (anchorPage !== focusPage) {
      setSelectionWarning(
        "Пока можно создавать ярлык только для выделения внутри одной страницы."
      );
      setSelectionText("");
      setSelectionRects([]);
      return;
    }

    const pageRect = anchorPageEl.getBoundingClientRect();
    const rects = normalizeRects(
      Array.from(range.getClientRects()),
      pageRect
    );

    if (!rects.length) {
      setSelectionWarning("Не удалось определить область выделения.");
      setSelectionText("");
      setSelectionRects([]);
      return;
    }

    setSelectionWarning("");
    setSelectionText(text);
    setSelectionPage(anchorPage);
    setSelectionRects(rects);
  }

  function handleSaveAnnotation() {
    const text = selectionText.trim();
    const comment = selectionComment.trim();

    if (!text || !projectId || !documentId || !selectionRects.length) return;

    const nextAnnotations = addAnnotation(projectId, documentId, {
      page: selectionPage,
      text,
      comment,
      rects: selectionRects,
      documentTitle,
    });

    setAnnotations(nextAnnotations);
    clearSelectionState();
  }

  function handleDeleteAnnotation(annotationId) {
    const nextAnnotations = deleteAnnotation(
      projectId,
      documentId,
      annotationId
    );
    setAnnotations(nextAnnotations);
  }

function scrollToAnnotation(annotation) {
  const container = scrollRef.current;
  const pageEl = pageRefs.current[annotation.page];

  if (!container || !pageEl) return;

  const firstRect = annotation.rects?.[0];

  if (firstRect) {
    const containerRect = container.getBoundingClientRect();
    const pageRect = pageEl.getBoundingClientRect();

    // Верх нужного фрагмента внутри viewport контейнера
    const targetTopInsideViewport =
      pageRect.top - containerRect.top + firstRect.y * pageRect.height;

    // Переводим это в координату scrollTop контейнера
    const targetScrollTop =
      container.scrollTop + targetTopInsideViewport - 24;

    container.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior: "smooth",
    });
  } else {
    const containerRect = container.getBoundingClientRect();
    const pageRect = pageEl.getBoundingClientRect();

    const targetScrollTop =
      container.scrollTop + (pageRect.top - containerRect.top) - 24;

    container.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior: "smooth",
    });
  }

  setFlashAnnotationId(annotation.id);

  if (flashTimerRef.current) {
    clearTimeout(flashTimerRef.current);
  }

  flashTimerRef.current = setTimeout(() => {
    setFlashAnnotationId(null);
  }, 1800);
}

  const hasDocument = !!fileUrl && !!projectId && !!documentId;

  return (
    <div
      style={{
        height: "100%",
        minHeight: 0,
        display: "grid",
        gridTemplateRows: "auto auto auto minmax(0, 1fr)",
        gap: "0.75rem",
        overflow: "hidden",
      }}
    >
      {/* Верхняя панель */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          flexWrap: "wrap",
          padding: "0.65rem",
          border: "1px solid #eee",
          borderRadius: 10,
          background: "#fafafa",
        }}
      >
        <div style={{ fontSize: 14 }}>
          Страница: <b>{numPages ? currentPage : "—"}</b>
          {numPages ? ` / ${numPages}` : ""}
        </div>

        <div style={{ width: 1, height: 24, background: "#ddd" }} />

        <button
          className="btn btn-secondary"
          onClick={() =>
            setScale((s) => clamp(Number((s - 0.1).toFixed(2)), 0.6, 2.2))
          }
          disabled={!hasDocument}
          type="button"
        >
          −
        </button>

        <div style={{ fontSize: 14 }}>
          Масштаб: <b>{Math.round(scale * 100)}%</b>
        </div>

        <button
          className="btn btn-secondary"
          onClick={() =>
            setScale((s) => clamp(Number((s + 0.1).toFixed(2)), 0.6, 2.2))
          }
          disabled={!hasDocument}
          type="button"
        >
          +
        </button>

        <div style={{ flex: 1 }} />

        <button
          className="btn btn-secondary"
          onClick={onDownload}
          disabled={!hasDocument}
          type="button"
        >
          Скачать PDF
        </button>
      </div>

      {/* Панель создания комментария к выделению */}
      {(selectionText || selectionWarning) && (
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: "0.75rem",
            background: "#fffef5",
          }}
        >
          {selectionWarning ? (
            <div style={{ color: "#b45309" }}>{selectionWarning}</div>
          ) : (
            <>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                Комментарий к выделению · стр. {selectionPage}
              </div>

              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.45,
                  background: "#fff",
                  border: "1px solid #eee",
                  borderRadius: 10,
                  padding: "0.65rem",
                  marginBottom: "0.65rem",
                  whiteSpace: "pre-wrap",
                  color: "#555",
                }}
              >
                {selectionText.length > 280
                  ? `${selectionText.slice(0, 280)}…`
                  : selectionText}
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <input
                  value={selectionComment}
                  onChange={(e) => setSelectionComment(e.target.value)}
                  placeholder="Комментарий к выделенному месту"
                  style={{
                    flex: "1 1 260px",
                    minWidth: 220,
                    padding: "0.6rem",
                    borderRadius: 10,
                    border: "1px solid #ddd",
                  }}
                />

                <button
                  className="btn btn-primary"
                  onClick={handleSaveAnnotation}
                  type="button"
                >
                  Сохранить ярлык
                </button>

                <button
                  className="btn btn-ghost"
                  onClick={clearSelectionState}
                  type="button"
                >
                  Отменить
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Список ярлыков */}
      <div
        style={{
          border: "1px solid #eee",
          borderRadius: 12,
          padding: "0.75rem",
          background: "#fff",
          maxHeight: 170,
          overflowY: "auto",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: "0.5rem" }}>
          Цитаты
        </div>

        {!projectId || !documentId ? (
          <div style={{ opacity: 0.8 }}>
            Цитаты появятся после выбора документа.
          </div>
        ) : annotations.length === 0 ? (
          <div style={{ opacity: 0.8 }}>
            Цитат нет
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {annotations.map((annotation) => (
              <div
                key={annotation.id}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 999,
                  padding: "0.45rem 0.7rem",
                  background:
                    flashAnnotationId === annotation.id ? "#fff4b8" : "#fafafa",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.45rem",
                  maxWidth: "100%",
                }}
                title={annotation.text}
              >
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => scrollToAnnotation(annotation)}
                  style={{
                    padding: 0,
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    maxWidth: 320,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  <b>
                    {annotation.comment?.trim()
                      ? annotation.comment
                      : `Комментарий · стр. ${annotation.page}`}
                  </b>
                  <span style={{ opacity: 0.7 }}>
                    {" "}
                    · стр. {annotation.page}
                  </span>
                </button>

                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => handleDeleteAnnotation(annotation.id)}
                  title={`Удалить ярлык (${formatDateTime(annotation.createdAt)})`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* PDF-область со своим скроллом */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onMouseUp={handleMouseUp}
        style={{
          minHeight: 0,
          overflow: "auto",
          border: "1px solid #eee",
          borderRadius: 12,
          padding: "0.75rem",
          background: "#f8fafc",
        }}
      >
        {loading && <div>Загрузка PDF…</div>}

        {!loading && error && (
          <div style={{ color: "crimson" }}>{error}</div>
        )}

        {!loading && !error && !fileUrl && (
          <div style={{ opacity: 0.8 }}>
            Выбери документ слева, чтобы открыть PDF.
          </div>
        )}

        {!loading && !error && fileUrl && (
          <Document
            file={fileUrl}
            onLoadSuccess={handleDocumentLoadSuccess}
            onLoadError={handleDocumentLoadError}
            loading="Подготовка PDF…"
            noData="Нет PDF для отображения"
          >
            {viewerError ? (
              <div style={{ color: "crimson" }}>{viewerError}</div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "1rem",
                  alignItems: "center",
                }}
              >
                {Array.from({ length: numPages }, (_, index) => {
                  const pageNumber = index + 1;
                  const pageAnnotations = annotationsByPage.get(pageNumber) || [];

                  return (
                    <div
                      key={pageNumber}
                      style={{
                        width: "100%",
                        display: "flex",
                        justifyContent: "center",
                      }}
                    >
                      <div
                        ref={(node) => {
                          if (node) pageRefs.current[pageNumber] = node;
                        }}
                        data-page-number={pageNumber}
                        style={{
                          position: "relative",
                          width: "fit-content",
                          background: "#fff",
                          borderRadius: 8,
                          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                        }}
                      >
                        <Page
                          pageNumber={pageNumber}
                          scale={scale}
                          renderTextLayer
                          renderAnnotationLayer
                        />

                        {/* Подсветки сохранённых аннотаций */}
                        {pageAnnotations.map((annotation) =>
                          (annotation.rects || []).map((rect, idx) => (
                            <div
                              key={`${annotation.id}_${idx}`}
                              title={annotation.comment || annotation.text}
                              style={{
                                position: "absolute",
                                left: `${rect.x * 100}%`,
                                top: `${rect.y * 100}%`,
                                width: `${rect.width * 100}%`,
                                height: `${rect.height * 100}%`,
                                background:
                                  flashAnnotationId === annotation.id
                                    ? "rgba(255, 193, 7, 0.45)"
                                    : "rgba(255, 235, 59, 0.32)",
                                boxShadow:
                                  flashAnnotationId === annotation.id
                                    ? "0 0 0 2px rgba(245, 158, 11, 0.35)"
                                    : "none",
                                borderRadius: 2,
                                pointerEvents: "none",
                                zIndex: 3,
                                transition: "all 0.25s ease",
                              }}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Document>
        )}
      </div>
    </div>
  );
}