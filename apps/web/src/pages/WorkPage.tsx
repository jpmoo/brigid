import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  ChevronsDownUp,
  ChevronsUpDown,
  FileText,
  LogOut,
  Maximize2,
  Minimize2,
  Settings,
} from "lucide-react";
import { buildOutline, deriveDocument } from "@brigid/shared";
import type { TemplateBody } from "@brigid/shared";
import { ApiError, api } from "../api.js";
import type { Block, Bookmark, Placement, Template, Work, WorkLevel } from "../api.js";
import { BrandMark } from "../components/Brand.js";
import { BodyEditor } from "../components/BodyEditor.js";
import { DocumentView, breakRefKey } from "../components/DocumentView.js";
import type { ViewMode } from "../components/DocumentView.js";
import { BookmarkStrip } from "../components/BookmarkStrip.js";
import { useDialogs } from "../components/Dialogs.js";
import { SearchBar, findMatches } from "../components/SearchBar.js";
import { ThemeToggle } from "../components/ThemeToggle.js";
import { OutlinePanel } from "../components/OutlinePanel.js";
import { useAuth } from "../auth/AuthContext.js";
import type { BreakChip } from "../components/OutlinePanel.js";

const wordFmt = new Intl.NumberFormat();
const MODE_KEY = "brigid.view.mode";
const SCALE_KEY = "brigid.text.scale";
const SCALE_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6];

interface AddRequest {
  relativeTo: string | null;
  placement: Placement;
}

export function WorkPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { username, logout } = useAuth();
  const dialogs = useDialogs();

  const [work, setWork] = useState<Work | null>(null);
  const [levels, setLevels] = useState<WorkLevel[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Zen hides the header and lets the outline retract; outside zen the outline
  // is simply always there.
  const [zen, setZen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [mode, setMode] = useState<ViewMode>(() =>
    // "reading" was the earlier name for this mode; map it forward so an
    // existing browser doesn't come back to a mode that no longer exists.
    localStorage.getItem(MODE_KEY) === "manuscript" ? "manuscript" : "book",
  );
  const [editingBreak, setEditingBreak] = useState<Block | null>(null);
  const [scaleIndex, setScaleIndex] = useState(() => {
    const stored = Number(localStorage.getItem(SCALE_KEY));
    return Number.isInteger(stored) && stored >= 0 && stored < SCALE_STEPS.length ? stored : 2;
  });
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [activeBookmark, setActiveBookmark] = useState<string | null>(null);
  const [adding, setAdding] = useState<AddRequest | null>(null);
  const [renaming, setRenaming] = useState<Block | null>(null);

  const blockRefs = useRef(new Map<string, HTMLDivElement>());
  const paneRef = useRef<HTMLElement>(null);
  const outlineRefs = useRef(new Map<string, HTMLDivElement>());
  // Set while a click is driving the document, so the observer doesn't fight
  // the smooth scroll it started.
  const scrollingTo = useRef<string | null>(null);

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
      const { bookmarks: bm } = await api.listBookmarks(id);
      setBookmarks(bm);
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
    localStorage.setItem(MODE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem(SCALE_KEY, String(scaleIndex));
  }, [scaleIndex]);

  // Escape leaves zen, so there's always a way back without hunting for a
  // control that zen itself has hidden.
  useEffect(() => {
    if (!zen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setZen(false);
        setPanelOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zen]);

  const templateMap = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);
  const entries = useMemo(() => buildOutline(blocks), [blocks]);

  const items = useMemo(() => {
    if (!work) return [];
    return deriveDocument<Block>({
      blocks,
      levels,
      templates,
      work: {
        title: work.title,
        subtitle: work.subtitle,
        authorFirstName: work.authorFirstName,
        authorLastName: work.authorLastName,
      },
    });
  }, [blocks, levels, templates, work]);

  // The outline shows each break attached above the block it precedes, so the
  // structure reads the same in both panes.
  const breaks = useMemo(() => {
    const map = new Map<string, BreakChip>();
    for (const item of items) {
      if (item.kind === "break") {
        map.set(item.blockId, { templateName: item.templateName, detached: item.detached });
      }
    }
    return map;
  }, [items]);

  const totalWords = useMemo(
    () =>
      blocks.reduce((sum, b) => {
        const fmt = templateMap.get(b.formatId);
        return fmt?.formatSettings?.countsTowardWordCount ? sum + b.wordCount : sum;
      }, 0),
    [blocks, templateMap],
  );

  // Only blocks that actually reach the page are searchable — a note is in the
  // outline, not in the manuscript.
  const searchable = useMemo(
    () =>
      items
        .filter((i) => i.kind === "block")
        .map((i) => (i.kind === "block" ? { id: i.block.id, contentText: i.block.contentText } : null))
        .filter((b): b is { id: string; contentText: string } => b !== null),
    [items],
  );
  const matches = useMemo(() => findMatches(searchable, query), [searchable, query]);
  const activeMatch = matches[matchIndex] ?? null;

  useEffect(() => {
    setMatchIndex(0);
  }, [query]);

  const registerRef = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) blockRefs.current.set(key, el);
    else blockRefs.current.delete(key);
  }, []);

  const scrollToBreak = useCallback((blockId: string) => {
    setSelectedId(blockId);
    blockRefs.current.get(breakRefKey(blockId))?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  const selectAndScroll = useCallback((blockId: string) => {
    setSelectedId(blockId);
    scrollingTo.current = blockId;
    // The document goes to the *top* of the section — you want to read it from
    // its beginning. It's the outline that stays centred, further down.
    blockRefs.current.get(blockId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Long enough for a smooth scroll to settle before the observer takes over.
    window.setTimeout(() => {
      if (scrollingTo.current === blockId) scrollingTo.current = null;
    }, 700);
  }, []);

  const registerOutlineRef = useCallback((blockId: string, el: HTMLDivElement | null) => {
    if (el) outlineRefs.current.set(blockId, el);
    else outlineRefs.current.delete(blockId);
  }, []);

  /**
   * Follow the manuscript as it scrolls: whichever block is highest in view is
   * the current one, and the outline scrolls just enough to keep it visible.
   * `block: "nearest"` so the panel barely moves unless it has to.
   */
  useEffect(() => {
    const pane = paneRef.current;
    const observed = [...blockRefs.current.entries()].filter(([key]) => !key.startsWith("break:"));
    if (!pane || observed.length === 0) return;

    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.getAttribute("data-block-id");
          if (!id) continue;
          if (entry.isIntersecting) visible.set(id, entry.boundingClientRect.top);
          else visible.delete(id);
        }
        if (scrollingTo.current || visible.size === 0) return;

        // Highest on screen wins — that's the one being read.
        const [topmost] = [...visible.entries()].sort((a, b) => a[1] - b[1]);
        if (!topmost) return;
        setSelectedId((current) => (current === topmost[0] ? current : topmost[0]));
      },
      {
        // The document pane is the scroller, not the window. Left to default,
        // the margins below are measured against the viewport instead and the
        // band lands in the wrong place — or nowhere.
        root: paneRef.current,
        // A band across the middle of the pane: the current block is the one
        // under the reader's eye, which is neither edge.
        rootMargin: "-35% 0px -45% 0px",
        threshold: 0,
      },
    );

    for (const [, el] of observed) observer.observe(el);
    return () => observer.disconnect();
  }, [items]);

  // Centre the current block in the outline, so there is always context above
  // and below it rather than it sitting against an edge.
  useEffect(() => {
    if (!selectedId) return;
    outlineRefs.current.get(selectedId)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selectedId]);

  // Only blocks with children can be collapsed, so they're the whole question:
  // if every one is already shut, the control opens them, and otherwise it
  // shuts them.
  const collapsible = useMemo(
    () => entries.filter((e) => e.childCount > 0).map((e) => e.block.id),
    [entries],
  );
  const allCollapsed = collapsible.length > 0 && collapsible.every((id) => collapsed.has(id));

  const toggleAll = useCallback(() => {
    setCollapsed(allCollapsed ? new Set() : new Set(collapsible));
  }, [allCollapsed, collapsible]);

  const toggleCollapse = useCallback((blockId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  }, []);

  const stepMatch = (delta: 1 | -1) => {
    if (matches.length === 0) return;
    const next = (matchIndex + delta + matches.length) % matches.length;
    setMatchIndex(next);
    const target = matches[next];
    if (target) selectAndScroll(target.blockId);
  };

  async function addBookmark(blockId: string) {
    try {
      const { bookmark } = await api.createBookmark(id, blockId);
      setBookmarks((prev) => [...prev, bookmark]);
      setActiveBookmark(bookmark.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not add the bookmark");
    }
  }

  async function renameBookmark(bookmark: Bookmark) {
    const answer = await dialogs.prompt({
      title: "Name this bookmark",
      fields: [{ label: "Name", value: bookmark.name }],
    });
    const name = answer?.[0]?.trim();
    if (!name) return;
    try {
      const { bookmark: updated } = await api.renameBookmark(bookmark.id, name);
      setBookmarks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not rename the bookmark");
    }
  }

  async function removeBookmark(bookmark: Bookmark) {
    try {
      await api.deleteBookmark(bookmark.id);
      setBookmarks((prev) => prev.filter((b) => b.id !== bookmark.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not remove the bookmark");
    }
  }

  async function onDelete(blockId: string) {
    const entry = entries.find((e) => e.block.id === blockId);
    const extra = entry && entry.childCount > 0 ? " and everything under it" : "";
    const ok = await dialogs.confirm({
      title: "Delete this block?",
      message: `The block${extra} will be removed. This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
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

  // Outside zen the outline is always shown; inside zen it retracts to an edge
  // and slides back out when the pointer reaches it.
  const showPanel = !zen || panelOpen;

  return (
    <div className={`work-shell${zen ? " zen" : ""}`}>
      <header className="app-header">
        <BrandMark />
        <div className="work-title">
          <strong>{work.title}</strong>
          {work.subtitle ? <em>{work.subtitle}</em> : null}
        </div>
        <div className="spacer" />

        <div className="segmented compact" role="group" aria-label="View mode">
          <button
            type="button"
            aria-pressed={mode === "book"}
            onClick={() => setMode("book")}
            title="Book — comfortable, book-like typography"
          >
            <BookOpen size={13} /> Book
          </button>
          <button
            type="button"
            aria-pressed={mode === "manuscript"}
            onClick={() => setMode("manuscript")}
            title="Manuscript — set exactly as your templates specify"
          >
            <FileText size={13} /> Manuscript
          </button>
        </div>

        <span className="muted" style={{ fontSize: 13 }}>
          {wordFmt.format(totalWords)} words
        </span>

        <ThemeToggle />

        <button
          className="btn ghost"
          type="button"
          title="Zen — hide everything but the manuscript (Esc to leave)"
          onClick={() => setZen(true)}
        >
          <Maximize2 size={16} />
        </button>
      </header>

      {error ? <div className="alert error work-error">{error}</div> : null}

      <div className={`work-body${showPanel ? "" : " panel-hidden"}`}>
        <aside
          className={`outline-panel${zen ? " floating" : " docked"}`}
          onMouseEnter={() => zen && setPanelOpen(true)}
          onMouseLeave={() => zen && setPanelOpen(false)}
        >
          <BookmarkStrip
            bookmarks={bookmarks}
            activeId={activeBookmark}
            onGo={(bookmark) => {
              setActiveBookmark(bookmark.id);
              selectAndScroll(bookmark.blockId);
            }}
            onRename={(bookmark) => void renameBookmark(bookmark)}
            onDelete={(bookmark) => void removeBookmark(bookmark)}
          />

          <div className="outline-head-bar">
            <span>Outline</span>
            <button
              className="outline-toggle-all"
              type="button"
              disabled={collapsible.length === 0}
              title={allCollapsed ? "Expand all" : "Collapse all"}
              aria-label={allCollapsed ? "Expand all" : "Collapse all"}
              onClick={toggleAll}
            >
              {allCollapsed ? <ChevronsUpDown size={13} /> : <ChevronsDownUp size={13} />}
            </button>
          </div>
          <OutlinePanel
            entries={entries}
            templates={templateMap}
            levels={levels}
            selectedId={selectedId}
            collapsed={collapsed}
            onToggleCollapse={toggleCollapse}
            onSelect={selectAndScroll}
            breaks={breaks}
            onSelectBreak={scrollToBreak}
            onAdd={(relativeTo, placement) => setAdding({ relativeTo, placement })}
            onRename={(blockId) => setRenaming(blocks.find((b) => b.id === blockId) ?? null)}
            onDelete={(blockId) => void onDelete(blockId)}
            registerRef={registerOutlineRef}
          />

          {/* Account and navigation live at the foot of the outline, out of the
              way of the manuscript rather than crowding the title bar. */}
          <div className="outline-foot">
            <Link className="btn ghost" to="/" title="Back to library">
              <ArrowLeft size={15} />
            </Link>
            <Link className="btn ghost" to="/settings" title="Settings">
              <Settings size={15} />
            </Link>
            <div className="spacer" />
            <span className="outline-user" title={username ?? undefined}>
              {username}
            </span>
            <button
              className="btn ghost"
              type="button"
              title="Sign out"
              onClick={() => void logout()}
            >
              <LogOut size={15} />
            </button>
          </div>
        </aside>

        <main className="document-pane" ref={paneRef}>
          <DocumentView
            items={items}
            registerRef={registerRef}
            selectedId={selectedId}
            onSelect={setSelectedId}
            mode={mode}
            onEditBreak={(blockId) =>
              setEditingBreak(blocks.find((b) => b.id === blockId) ?? null)
            }
            textScale={SCALE_STEPS[scaleIndex] ?? 1}
            bookmarkedBlockIds={new Set(bookmarks.map((b) => b.blockId))}
            onDropBookmark={(blockId) => void addBookmark(blockId)}
            search={query.trim().toLowerCase()}
            activeMatch={activeMatch}
          />
          {zen ? (
            // Fades in together with the exit control: in zen the only things
            // worth reaching for are the size of the type and the way out.
            <div className="zen-controls">
              <div className="segmented compact" role="group" aria-label="View mode">
                <button
                  type="button"
                  aria-pressed={mode === "book"}
                  onClick={() => setMode("book")}
                  title="Book — comfortable, book-like typography"
                >
                  <BookOpen size={13} /> Book
                </button>
                <button
                  type="button"
                  aria-pressed={mode === "manuscript"}
                  onClick={() => setMode("manuscript")}
                  title="Manuscript — set exactly as your templates specify"
                >
                  <FileText size={13} /> Manuscript
                </button>
              </div>

              <TextSize scaleIndex={scaleIndex} setScaleIndex={setScaleIndex} />

              <span className="zen-words">{wordFmt.format(totalWords)} words</span>

              <button
                className="zen-exit"
                type="button"
                title="Leave zen (Esc)"
                onClick={() => setZen(false)}
              >
                <Minimize2 size={15} />
              </button>
            </div>
          ) : null}
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

      {editingBreak ? (
        <BreakEditor
          block={editingBreak}
          onClose={() => setEditingBreak(null)}
          onSaved={() => {
            setEditingBreak(null);
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

/** The same control in the header and in zen, so they can't drift apart. */
function TextSize({
  scaleIndex,
  setScaleIndex,
}: {
  scaleIndex: number;
  setScaleIndex: (fn: (i: number) => number) => void;
}) {
  return (
    <div className="text-size" role="group" aria-label="Text size">
      <button
        type="button"
        title="Smaller text"
        disabled={scaleIndex === 0}
        onClick={() => setScaleIndex((i) => Math.max(0, i - 1))}
      >
        A
      </button>
      <button
        type="button"
        title="Larger text"
        disabled={scaleIndex === SCALE_STEPS.length - 1}
        onClick={() => setScaleIndex((i) => Math.min(SCALE_STEPS.length - 1, i + 1))}
      >
        A
      </button>
    </div>
  );
}

const PLACEMENT_LABEL: Record<Placement, string> = {
  root: "at the top level",
  "sibling-before": "as a sibling, just before",
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

/**
 * Edits the break that sits *before* a block. A break follows its level's
 * template until it's edited here, at which point it detaches and becomes this
 * block's own — so one chapter break can read differently from all the others.
 */
function BreakEditor({
  block,
  onClose,
  onSaved,
}: {
  block: Block;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialogs = useDialogs();
  const [body, setBody] = useState<TemplateBody | null>(
    block.breakBody ?? null,
  );
  const [detached, setDetached] = useState(Boolean(block.breakBody));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function detach() {
    setError(null);
    setBusy(true);
    try {
      const { block: updated } = await api.detachBreak(block.id);
      setBody(updated.breakBody ?? { nodes: [] });
      setDetached(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not detach this break");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!body) return;
    setBusy(true);
    try {
      await api.updateBreak(block.id, body);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not save");
      setBusy(false);
    }
  }

  async function revert() {
    const ok = await dialogs.confirm({
      title: "Follow the template again?",
      message: "This break's edits will be discarded and it will follow its level's template.",
      confirmLabel: "Discard edits",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.revertBreak(block.id);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not revert");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2 className="card-title">Break before this block</h2>
        <p className="card-subtitle">
          {detached
            ? "This break is edited for this block alone. Other breaks at the same level are untouched."
            : "This break follows its level's template, so it changes if you move the block to a different indentation. Edit it to make it this block's own."}
        </p>

        {error ? <div className="alert error">{error}</div> : null}

        {detached && body ? (
          <BodyEditor body={body} onChange={setBody} />
        ) : (
          <p className="muted" style={{ marginBottom: 18 }}>
            Nothing here is editable until you detach it.
          </p>
        )}

        <div className="modal-actions">
          {detached ? (
            <button className="btn secondary" type="button" onClick={() => void revert()} disabled={busy}>
              Follow the template again
            </button>
          ) : null}
          <div className="spacer" />
          <button className="btn secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          {detached ? (
            <button className="btn" type="button" onClick={() => void save()} disabled={busy || !body}>
              {busy ? "Saving…" : "Save"}
            </button>
          ) : (
            <button className="btn" type="button" onClick={() => void detach()} disabled={busy}>
              {busy ? "Detaching…" : "Edit just this one"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
