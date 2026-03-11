// src/pages/WorkspacePage.jsx
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import PdfWorkspaceViewer from "../components/PdfWorkspaceViewer";

function normalizeProjectDoc(d) {
  return {
    id: d?.id ?? null,
    uuid: d?.uuid ?? "",
    title: d?.title ?? "Без названия",
    documentType: d?.document_type ?? "",
    sourceLink: d?.source_link ?? "",
    accessLevel: d?.access_level ?? "",
    documentDate: d?.document_date ?? "",
    createdAt: d?.created_at ?? "",
    summary: d?.summary ?? "",
    fullText: d?.full_text ?? "",
    files: Array.isArray(d?.files) ? d.files : [],
    raw: d,
  };
}

function asList(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.projects)) return data.projects;
  if (Array.isArray(data.documents)) return data.documents;
  if (Array.isArray(data.selected_documents)) return data.selected_documents;
  if (Array.isArray(data.data)) return data.data;
  return [];
}

function getProjectId(p) {
  return p?.id ?? p?.project_id ?? p?.uuid ?? p?._id ?? null;
}

function getProjectName(p) {
  return p?.name ?? p?.title ?? `Проект ${getProjectId(p)}`;
}

function getProjectDescription(p) {
  return p?.description ?? p?.project_description ?? "";
}

function getDocId(d) {
  return d?.id ?? null;
}

function getDocTitle(d) {
  return d?.title ?? "Без названия";
}

function getDocSourceLink(d) {
  return d?.sourceLink ?? "";
}

function ensureAbsoluteUrl(url) {
  if (!url) return "";
  const u = String(url).trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("//")) return `https:${u}`;
  return `https://${u}`;
}

function pickFirstUrl(res) {
  if (!res) return "";
  if (typeof res === "string") return res;

  if (typeof res.url === "string") return res.url;
  if (typeof res.download_url === "string") return res.download_url;
  if (typeof res.href === "string") return res.href;

  if (Array.isArray(res.urls) && res.urls[0]) return res.urls[0];
  if (Array.isArray(res.download_urls) && res.download_urls[0]) {
    return res.download_urls[0];
  }

  if (Array.isArray(res) && res[0]) {
    if (typeof res[0] === "string") return res[0];
    if (typeof res[0] === "object") {
      return res[0].url || res[0].download_url || res[0].href || "";
    }
  }

  for (const v of Object.values(res)) {
    if (
      typeof v === "string" &&
      (v.startsWith("http://") || v.startsWith("https://"))
    ) {
      return v;
    }
  }

  return "";
}

function triggerDownload(url) {
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.click();
}

export default function WorkspacePage({ onGoList }) {
  // ---------- Проекты ----------
  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState(null);

  // ---------- Документы выбранного проекта ----------
  const [documents, setDocuments] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState("");
  const [selectedDocId, setSelectedDocId] = useState(null);

  // ---------- PDF ----------
  const [activePdfUrl, setActivePdfUrl] = useState("");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState("");

  // ---------- UI ----------
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  // ---------- Создание проекта ----------
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");

  async function loadProjects({
    keepSelection = true,
    preferredProjectId = null,
  } = {}) {
    try {
      setProjectsLoading(true);
      setProjectsError("");

      const data = await api.listWorkspaceProjects();
      const list = asList(data);

      setProjects(list);

      if (!list.length) {
        setSelectedProjectId(null);
        return;
      }

      if (preferredProjectId != null) {
        const exists = list.some(
          (p) => String(getProjectId(p)) === String(preferredProjectId)
        );
        if (exists) {
          setSelectedProjectId(preferredProjectId);
          return;
        }
      }

      if (!keepSelection || !selectedProjectId) {
        setSelectedProjectId(getProjectId(list[0]));
        return;
      }

      const stillExists = list.some(
        (p) => String(getProjectId(p)) === String(selectedProjectId)
      );

      if (!stillExists) {
        setSelectedProjectId(getProjectId(list[0]));
      }
    } catch (e) {
      setProjectsError(e.message || "Не удалось загрузить проекты");
    } finally {
      setProjectsLoading(false);
    }
  }

  async function loadDocuments(projectId) {
    if (!projectId) {
      setDocuments([]);
      setSelectedDocId(null);
      return;
    }

    try {
      setDocsLoading(true);
      setDocsError("");

      const data = await api.listWorkspaceProjectDocuments(projectId);
      const list = asList(data).map(normalizeProjectDoc);

      setDocuments(list);

      if (!list.length) {
        setSelectedDocId(null);
        return;
      }

      const stillExists = list.some(
        (d) => String(getDocId(d)) === String(selectedDocId)
      );

      if (!stillExists) {
        setSelectedDocId(getDocId(list[0]));
      }
    } catch (e) {
      setDocsError(e.message || "Не удалось загрузить документы проекта");
    } finally {
      setDocsLoading(false);
    }
  }

  async function resolvePdfUrl(doc) {
    if (!doc) {
      setActivePdfUrl("");
      setPdfError("");
      return;
    }

    try {
      setPdfLoading(true);
      setPdfError("");

      if (doc.id) {
        const res = await api.getDocumentDownloadUrls(doc.id);
        const url = pickFirstUrl(res);

        if (url) {
          setActivePdfUrl(url);
          return;
        }
      }

      const fallbackUrl = getDocSourceLink(doc);
      if (fallbackUrl) {
        setActivePdfUrl(ensureAbsoluteUrl(fallbackUrl));
        return;
      }

      setActivePdfUrl("");
      setPdfError("Не удалось получить ссылку на PDF");
    } catch (e) {
      const fallbackUrl = getDocSourceLink(doc);

      if (fallbackUrl) {
        setActivePdfUrl(ensureAbsoluteUrl(fallbackUrl));
      } else {
        setActivePdfUrl("");
        setPdfError(e.message || "Не удалось загрузить PDF");
      }
    } finally {
      setPdfLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadDocuments(selectedProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  const selectedProject = useMemo(() => {
    return (
      projects.find(
        (p) => String(getProjectId(p)) === String(selectedProjectId)
      ) || null
    );
  }, [projects, selectedProjectId]);

  const selectedDoc = useMemo(() => {
    return (
      documents.find((d) => String(getDocId(d)) === String(selectedDocId)) ||
      null
    );
  }, [documents, selectedDocId]);

  useEffect(() => {
    resolvePdfUrl(selectedDoc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDoc]);

  async function handleCreateProject() {
    const name = newProjectName.trim();
    const description = newProjectDescription.trim();

    if (!name) {
      setMessage("Введите название проекта");
      return;
    }

    try {
      setBusy(true);
      setMessage("");

      const created = await api.createWorkspaceProject({
        name,
        description,
        document_ids: [],
      });

      const createdId = getProjectId(created);

      setNewProjectName("");
      setNewProjectDescription("");
      setMessage("Проект создан");

      await loadProjects({
        keepSelection: false,
        preferredProjectId: createdId,
      });
    } catch (e) {
      setMessage(e.message || "Не удалось создать проект");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteProject(projectId) {
    if (!projectId) return;

    const ok = window.confirm(
      "Удалить проект? Документы из базы не удалятся, только связь с проектом."
    );
    if (!ok) return;

    try {
      setBusy(true);
      setMessage("");

      await api.deleteWorkspaceProject(projectId);
      setMessage("Проект удалён");

      await loadProjects({ keepSelection: false });
    } catch (e) {
      setMessage(e.message || "Не удалось удалить проект");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteDocFromProject(projectId, documentId) {
    if (!projectId || !documentId) return;

    const ok = window.confirm("Удалить документ из проекта?");
    if (!ok) return;

    try {
      setBusy(true);
      setMessage("");

      await api.deleteWorkspaceProjectDocument(projectId, documentId);
      setMessage("Документ удалён из проекта");

      await loadDocuments(projectId);
    } catch (e) {
      setMessage(e.message || "Не удалось удалить документ из проекта");
    } finally {
      setBusy(false);
    }
  }

  async function handleDownloadDoc(doc) {
    try {
      setBusy(true);
      setMessage("");

      if (doc?.id) {
        const res = await api.getDocumentDownloadUrls(doc.id);
        const url = pickFirstUrl(res);

        if (url) {
          triggerDownload(url);
          return;
        }
      }

      if (doc?.sourceLink) {
        triggerDownload(ensureAbsoluteUrl(doc.sourceLink));
        return;
      }

      setMessage("Не удалось получить ссылку для скачивания");
    } catch (e) {
      if (doc?.sourceLink) {
        triggerDownload(ensureAbsoluteUrl(doc.sourceLink));
        setMessage("Документ открыт по резервной ссылке");
      } else {
        setMessage(e.message || "Не удалось скачать документ");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        padding: "1rem",
        height: "calc(100vh - 150px)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          marginBottom: "1rem",
          flexShrink: 0,
        }}
      >
        <h2 style={{ margin: 0 }}>Мои проекты</h2>
        <div style={{ flex: 1 }} />
        <button
          className="btn btn-secondary"
          onClick={onGoList}
          type="button"
        >
          Назад к поиску
        </button>
      </div>

      {message && (
        <div
          style={{
            marginBottom: "0.75rem",
            padding: "0.5rem 0.75rem",
            background: "#f5f5f5",
            borderRadius: 8,
            flexShrink: 0,
          }}
        >
          {message}
        </div>
      )}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "360px minmax(0, 1fr)",
          gap: "1rem",
          overflow: "hidden",
        }}
      >
        {/* Левый столбец */}
        <div
          style={{
            display: "grid",
            gridTemplateRows: "auto minmax(0, 1fr)",
            gap: "0.75rem",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {/* Маленький блок создания проекта */}
          <div
            style={{
              border: "1px solid #eee",
              borderRadius: 12,
              padding: "0.75rem",
              flexShrink: 0,
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: "0.75rem" }}>
              Новый проект
            </h3>

            <input
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Название проекта"
              style={{
                width: "100%",
                padding: "0.5rem",
                marginBottom: "0.5rem",
              }}
              disabled={busy}
            />

            <textarea
              value={newProjectDescription}
              onChange={(e) => setNewProjectDescription(e.target.value)}
              placeholder="Описание проекта (необязательно)"
              style={{
                width: "100%",
                padding: "0.5rem",
                minHeight: 70,
                resize: "vertical",
                marginBottom: "0.5rem",
              }}
              disabled={busy}
            />

            <button
              className="btn btn-primary"
              onClick={handleCreateProject}
              disabled={busy}
              type="button"
              style={{ width: "100%" }}
            >
              Создать проект
            </button>
          </div>

          {/* Две половины: проекты / документы */}
          <div
            style={{
              display: "grid",
              gridTemplateRows: "minmax(0, 1fr) minmax(0, 1fr)",
              gap: "0.75rem",
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            {/* Блок проектов */}
            <div
              style={{
                border: "1px solid #eee",
                borderRadius: 12,
                padding: "0.75rem",
                display: "grid",
                gridTemplateRows: "auto auto minmax(0, 1fr)",
                minHeight: 0,
                overflow: "hidden",
              }}
            >
              <h3 style={{ marginTop: 0, marginBottom: "0.5rem" }}>Проекты</h3>

              <div style={{ marginBottom: "0.5rem", flexShrink: 0 }}>
                {projectsLoading && <div>Загрузка проектов…</div>}
                {projectsError && (
                  <div style={{ color: "crimson" }}>{projectsError}</div>
                )}
                {!projectsLoading && !projectsError && projects.length === 0 && (
                  <div style={{ opacity: 0.8 }}>
                    Проектов пока нет.
                  </div>
                )}
              </div>

              <div
                style={{
                  overflowY: "auto",
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                  paddingRight: 4,
                }}
              >
                {projects.map((p) => {
                  const id = getProjectId(p);
                  const active = String(id) === String(selectedProjectId);
                  const description = getProjectDescription(p);

                  return (
                    <div
                      key={String(id)}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "0.5rem",
                        padding: "0.5rem",
                        borderRadius: 10,
                        border: active ? "1px solid #bbb" : "1px solid #eee",
                        background: active ? "#fafafa" : "white",
                        cursor: "pointer",
                      }}
                      onClick={() => setSelectedProjectId(id)}
                      role="button"
                      tabIndex={0}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {getProjectName(p)}
                        </div>

                        {description && (
                          <div
                            style={{
                              fontSize: 12,
                              opacity: 0.75,
                              marginTop: 4,
                              lineHeight: 1.35,
                            }}
                          >
                            {description}
                          </div>
                        )}
                      </div>

                      <button
                        className="btn btn-ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteProject(id);
                        }}
                        disabled={busy}
                        type="button"
                        title="Удалить проект"
                      >
                        🗑
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Блок документов */}
            <div
              style={{
                border: "1px solid #eee",
                borderRadius: 12,
                padding: "0.75rem",
                display: "grid",
                gridTemplateRows: "auto auto minmax(0, 1fr)",
                minHeight: 0,
                overflow: "hidden",
              }}
            >
              <h3 style={{ marginTop: 0, marginBottom: "0.5rem" }}>
                Документы
                {selectedProject ? (
                  <span style={{ fontWeight: 400, opacity: 0.7 }}>
                    {" "}
                    · {getProjectName(selectedProject)}
                  </span>
                ) : null}
              </h3>

              <div style={{ marginBottom: "0.5rem", flexShrink: 0 }}>
                {!selectedProjectId && (
                  <div style={{ opacity: 0.8 }}>Сначала выбери проект</div>
                )}

                {selectedProjectId && docsLoading && <div>Загрузка документов…</div>}

                {selectedProjectId && docsError && (
                  <div style={{ color: "crimson" }}>{docsError}</div>
                )}

                {selectedProjectId &&
                  !docsLoading &&
                  !docsError &&
                  documents.length === 0 && (
                    <div style={{ opacity: 0.8 }}>
                      В проекте пока нет документов.
                    </div>
                  )}
              </div>

              <div
                style={{
                  overflowY: "auto",
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                  paddingRight: 4,
                }}
              >
                {selectedProjectId &&
                  !docsLoading &&
                  !docsError &&
                  documents.map((d) => {
                    const docId = getDocId(d);
                    const active = String(docId) === String(selectedDocId);

                    return (
                      <div
                        key={String(docId)}
                        style={{
                          padding: "0.6rem",
                          borderRadius: 10,
                          border: active ? "1px solid #bbb" : "1px solid #eee",
                          background: active ? "#fafafa" : "white",
                          cursor: "pointer",
                        }}
                        onClick={() => setSelectedDocId(docId)}
                        role="button"
                        tabIndex={0}
                      >
                        <div
                          style={{
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {getDocTitle(d)}
                        </div>

                        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                          {d.documentType || "PDF"}
                        </div>

                        <div
                          style={{
                            display: "flex",
                            gap: "0.4rem",
                            marginTop: "0.5rem",
                            flexWrap: "wrap",
                          }}
                        >
                          <button
                            className="btn btn-secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedDocId(docId);
                            }}
                            disabled={busy}
                            type="button"
                          >
                            Открыть
                          </button>

                          <button
                            className="btn btn-secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownloadDoc(d);
                            }}
                            disabled={busy}
                            type="button"
                          >
                            Скачать
                          </button>

                          <button
                            className="btn btn-ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteDocFromProject(selectedProjectId, docId);
                            }}
                            disabled={busy || !docId}
                            type="button"
                            title="Удалить из проекта"
                          >
                            🗑
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        </div>

        {/* Правая рабочая зона */}
        <div
          style={{
            border: "1px solid #eee",
            borderRadius: 12,
            padding: "0.75rem",
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div style={{ marginBottom: "0.75rem", flexShrink: 0 }}>
            <h3 style={{ marginTop: 0, marginBottom: 6 }}>Работа с документами</h3>

            {selectedDoc ? (
              <div>
                <div style={{ fontWeight: 600 }}>{selectedDoc.title}</div>
              </div>
            ) : (
              <div style={{ opacity: 0.8 }}>
                Выберите нужный документ
              </div>
            )}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <PdfWorkspaceViewer
              fileUrl={activePdfUrl}
              projectId={selectedProjectId}
              documentId={selectedDocId}
              documentTitle={selectedDoc?.title || ""}
              loading={pdfLoading}
              error={pdfError}
              onDownload={() => {
                if (selectedDoc) handleDownloadDoc(selectedDoc);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}