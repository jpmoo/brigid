import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, PanelLeftClose, PanelLeftOpen, Pin, PinOff } from "lucide-react";
import { buildOutline, deriveDocument } from "@brigid/shared";
import type { TemplateLike } from "@brigid/shared";
import { ApiError, api } from "../api.js";
import type { Block, Placement, Template, Work, WorkLevel } from "../api.js";
import { BrandMark } from "../components/Brand.js";
import { DocumentView } from "../components/DocumentView.js";
import { OutlinePanel } from "../components/OutlinePanel.js";

const wordFmt = new Intl.NumberFormat();
const PANEL_KEY = "brigid.outline.pinned";

interface AddRequest {
  relativeTo: string | null;
  placement: Placement;
}

export function WorkPage() {
  const { id = "" } = useParams<{ id: string }>();

  const [work, setWork] = useState<Work | null>(null);
  const [levels, setLevels] = useState<WorkLevel[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pinned, setPinned] = useState(() => localStorage.getItem(PANEL_KEY) !== "false");
  const [panelOpen, setPanelOpen] = useState(true);
  const [adding, setAdding] = useState<AddRequest | null>(null);
  const [renaming, setRenaming] = useState<Block | null>(null);

  const blockRefs = useRef(new Map<string, HTMLDivElement>());

  const load = useCallback(async () => {
    try {
      const [{ work: w, levels: ls }, { blocks: bs }, { templates: ts }] = await Promise.all([
        api.getWork(id),
        api.listBlocks(id),
        api.listTemplates(),
      ]);
      setWork(w);
      setLevels(ls);
      setBlocks(bs);
      setTemplates(ts);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not open this work");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    localStorage.setItem(PANEL_KEY, String(pinned));
  }, [pinned]);

  const templateMap = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);
  const entries = useMemo(() => buildOutline(blocks), [blocks]);

  const items = useMemo(() => {
    if (!work) return [];
    return deriveDocument<Block>({
      blocks,
      levels,
      // The renderer only needs the structural fields; the API shape is wider.
      templates: templates as unknown as TemplateLike[],
      work: {
        title: work.title,
        subtitle: work.subtitle,
        authorFirstName: work.authorFirstName,
        authorLastName: work.authorLastName,
      },
    });
  }, [blocks, levels, templates, work]);

  const totalWords = useMemo(
    () =>
      blocks.reduce((sum, b) => {
        const fmt = templateMap.get(b.formatId);
        return fmt?.formatSettings?.countsTowardWordCount ? sum + b.wordCount : sum;
      }, 0),
    [blocks, templateMap],
  );

  const registerRef = useCallback((blockId: string, el: HTMLDivElement | null) => {
    if (el) blockRefs.current.set(blockId, el);
    else blockRefs.current.delete(blockId);
  }, []);

  const selectAndScroll = useCallback((blockId: string) => {
    setSelectedId(blockId);
    blockRefs.current.get(blockId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const toggleCollapse = useCallback((blockId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  }, []);

  async function onDelete(blockId: string) {
    const entry = entries.find((e) => e.block.id === blockId);
    const extra = entry && entry.childCount > 0 ? " and everything under it" : "";
    if (!confirm(`Delete this block${extra}? This can't be undone.`)) return;
    try {
      await api.deleteBlock(blockId);
      if (selectedId === blockId) setSelectedId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not delete");
    }
  }

  if (loading) return <div className="loading">Opening…</div>;
  if (!work) return <div className="loading">{error ?? "Not found."}</div>;

  const showPanel = pinned || panelOpen;

  return (
    <div className="work-shell">
      <header className="app-header">
        <Link className="btn ghost" to="/" title="Back to library">
          <ArrowLeft size={16} />
        </Link>
        <BrandMark />
        <div className="work-title">
          <strong>{work.title}</strong>
          {work.subtitle ? <em>{work.subtitle}</em> : null}
        </div>
        <div className="spacer" />
        <span className="muted" style={{ fontSize: 13 }}>
          {wordFmt.format(totalWords)} words
        </span>
        <button
          className="btn ghost"
          type="button"
          title={pinned ? "Unpin outline" : "Pin outline"}
          onClick={() => setPinned((v) => !v)}
        >
          {pinned ? <Pin size={16} /> : <PinOff size={16} />}
        </button>
        <button
          className="btn ghost"
          type="button"
          title={showPanel ? "Hide outline" : "Show outline"}
          onClick={() => (pinned ? setPinned(false) : setPanelOpen((v) => !v))}
        >
          {showPanel ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
      </header>

      {error ? <div className="alert error work-error">{error}</div> : null}

      <div className={`work-body${showPanel ? "" : " panel-hidden"}`}>
        <aside
          className={`outline-panel${pinned ? " pinned" : " floating"}`}
          // Unpinned, the panel hovers over the document and retracts when the
          // pointer leaves — the writer gets the full measure back for reading.
          onMouseEnter={() => !pinned && setPanelOpen(true)}
          onMouseLeave={() => !pinned && setPanelOpen(false)}
        >
          <div className="outline-head-bar">
            <span>Outline</span>
            <span className="muted">{entries.length}</span>
          </div>
          <OutlinePanel
            entries={entries}
            templates={templateMap}
            levels={levels}
            selectedId={selectedId}
            collapsed={collapsed}
            onToggleCollapse={toggleCollapse}
            onSelect={selectAndScroll}
            onAdd={(relativeTo, placement) => setAdding({ relativeTo, placement })}
            onRename={(blockId) => setRenaming(blocks.find((b) => b.id === blockId) ?? null)}
            onDelete={(blockId) => void onDelete(blockId)}
          />
        </aside>

        <main className="document-pane">
          <DocumentView
            items={items}
            registerRef={registerRef}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </main>
      </div>

      {adding ? (
        <AddBlockModal
          workId={id}
          request={adding}
          templates={templates.filter((t) => t.category === "block-format")}
          onClose={() => setAdding(null)}
          onCreated={(created) => {
            setAdding(null);
            setSelectedId(created.id);
            void load();
          }}
        />
      ) : null}

      {renaming ? (
        <RenameModal
          block={renaming}
          onClose={() => setRenaming(null)}
          onSaved={() => {
            setRenaming(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

const PLACEMENT_LABEL: Record<Placement, string> = {
  root: "at the top level",
  sibling: "as a sibling, just after",
  child: "as a child",
  parent: "one level up",
};

function AddBlockModal({
  workId,
  request,
  templates,
  onClose,
  onCreated,
}: {
  workId: string;
  request: AddRequest;
  templates: Template[];
  onClose: () => void;
  onCreated: (block: Block) => void;
}) {
  const [label, setLabel] = useState("");
  const [formatId, setFormatId] = useState(
    templates.find((t) => t.builtinKey === "regular-text")?.id ?? templates[0]?.id ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { block } = await api.createBlock(workId, {
        formatId,
        placement: request.placement,
        relativeTo: request.relativeTo,
        label: label || null,
      });
      onCreated(block);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not add the block");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit}>
        <h2 className="card-title">New block</h2>
        <p className="card-subtitle">Placed {PLACEMENT_LABEL[request.placement]}.</p>

        {error ? <div className="alert error">{error}</div> : null}

        <div className="field">
          <label className="field-label" htmlFor="blockLabel">
            Label
          </label>
          <input
            id="blockLabel"
            type="text"
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Shown in the outline"
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="blockFormat">
            Format
          </label>
          <select id="blockFormat" value={formatId} onChange={(e) => setFormatId(e.target.value)}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="modal-actions">
          <button className="btn secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" type="submit" disabled={busy || !formatId}>
            {busy ? "Adding…" : "Add block"}
          </button>
        </div>
      </form>
    </div>
  );
}

function RenameModal({
  block,
  onClose,
  onSaved,
}: {
  block: Block;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(block.label ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.updateBlock(block.id, { label: label || null });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not rename");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit}>
        <h2 className="card-title">Rename block</h2>
        <p className="card-subtitle">
          The label shows in the outline, and templates can print it as the level title.
        </p>
        {error ? <div className="alert error">{error}</div> : null}
        <div className="field">
          <label className="field-label" htmlFor="renameLabel">
            Label
          </label>
          <input
            id="renameLabel"
            type="text"
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="modal-actions">
          <button className="btn secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" type="submit" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
