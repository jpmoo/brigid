import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  FileText,
  LogOut,
  Maximize2,
  Minimize2,
  PanelLeft,
  Settings,
  X
} from "lucide-react";
import { buildOutline, currentBlockAt, deriveDocument, foldForSearch, smartenText } from "@brigid/shared";
import type { BlockOptions, ProseDoc, TemplateBody, Typography } from "@brigid/shared";
import { ApiError, api } from "../api.js";
import type { Block, Bookmark, Placement, Template, Work, WorkLevel } from "../api.js";
import { BrandMark } from "../components/Brand.js";
import { DocumentView, breakRefKey } from "../components/DocumentView.js";
import type { ViewMode } from "../components/DocumentView.js";
import { BookmarkStrip } from "../components/BookmarkStrip.js";
import { FormatFields } from "../components/FormatFields.js";
import { useDialogs } from "../components/Dialogs.js";
import { SearchBar, findMatches } from "../components/SearchBar.js";
import { ThemeToggle } from "../components/ThemeToggle.js";
import { useSavedFlash } from "../useSavedFlash.js";
import { OutlinePanel } from "../components/OutlinePanel.js";
import { ProseEditor } from "../components/ProseEditor.js";
import { useSpelling } from "../spelling.js";
import { useAuth } from "../auth/AuthContext.js";
import { PHONE, useMediaQuery } from "../useMediaQuery.js";
import type { BreakChip } from "../components/OutlinePanel.js";

const wordFmt = new Intl.NumberFormat();
const MODE_KEY = "brigid.view.mode";
const SCALE_KEY = "brigid.text.scale";
const SCALE_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6];
const DEFAULT_SCALE = 1;

/**
 * The size the writer set, as a multiplier.
 *
 * The server holds it — one writer, one decision, and it should hold across
 * their machines and outlive clearing site data. The browser keeps a copy only
 * so the first paint is the right size rather than the default one for as long
 * as the request takes.
 *
 * Stored as the multiplier rather than as a position in the ladder above, so
 * changing the ladder doesn't silently resize everyone's manuscript.
 */
function cachedScale(): number {
  const raw = localStorage.getItem(SCALE_KEY);
  // Deliberately not Number(raw): Number(null) is 0, which is a perfectly good
  // number and passed every check a stored value would — so a browser that had
  // never set one was told the size was zero-point-eight and the default was
  // never reached.
  if (raw === null) return DEFAULT_SCALE;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value >= 0.5 && value <= 3 ? value : DEFAULT_SCALE;
}

/** The nearest rung to a saved multiplier, so the buttons still step evenly. */
function stepForScale(scale: number): number {
  let best = 0;
  for (let i = 1; i < SCALE_STEPS.length; i += 1) {
    const step = SCALE_STEPS[i] ?? 1;
    if (Math.abs(step - scale) < Math.abs((SCALE_STEPS[best] ?? 1) - scale)) best = i;
  }
  return best;
}

interface AddRequest {
  relativeTo: string | null;
  placement: Placement;
}

export function WorkPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { logout } = useAuth();
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
  /**
   * On a phone the outline can't sit beside the manuscript — there isn't room
   * for both — so it becomes a sheet pulled down over it, and "showing" is
   * something the writer asks for rather than the default.
   */
  const phone = useMediaQuery(PHONE);
  const [mode, setMode] = useState<ViewMode>(() =>
    // "reading" was the earlier name for this mode; map it forward so an
    // existing browser doesn't come back to a mode that no longer exists.
    localStorage.getItem(MODE_KEY) === "manuscript" ? "manuscript" : "book",
  );
  const [editingBreak, setEditingBreak] = useState<Block | null>(null);
  const [editingFormat, setEditingFormat] = useState<Block | null>(null);
  const [editingOptions, setEditingOptions] = useState<Block | null>(null);
  const [scaleIndex, setScaleIndex] = useState(() => stepForScale(cachedScale()));
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  // Set when the index moved because the page scrolled, so the effect that
  // scrolls to the active hit doesn't chase it back.
  const fromScroll = useRef(false);
  // The tracker below runs off a listener bound once, so it reads the current
  // index here rather than closing over a stale one.
  const matchIndexRef = useRef(0);
  matchIndexRef.current = matchIndex;
  const queryRef = useRef("");
  queryRef.current = query;
  const [activeBookmark, setActiveBookmark] = useState<string | null>(null);
  const [adding, setAdding] = useState<AddRequest | null>(null);
  const [renaming, setRenaming] = useState<Block | null>(null);

  const blockRefs = useRef(new Map<string, HTMLDivElement>());
  /**
   * The manuscript pane, as state rather than only as a ref.
   *
   * The page returns a loading line until the work arrives, so on the first
   * render there is no pane at all — and an effect that reads a ref on mount
   * finds null and gives up. A ref changing does not re-run anything, so
   * whether the scroll listener ever got attached came down to whether some
   * other dependency happened to change after the pane appeared. It did, until
   * it didn't. Set through a callback ref, the effect below runs exactly when
   * there is something to attach to.
   */
  const paneRef = useRef<HTMLElement | null>(null);
  const [paneEl, setPaneEl] = useState<HTMLElement | null>(null);
  const attachPane = useCallback((el: HTMLElement | null) => {
    paneRef.current = el;
    setPaneEl(el);
  }, []);
  const outlineRefs = useRef(new Map<string, HTMLDivElement>());
  // Set while a click is driving the document, so the observer doesn't fight
  // the smooth scroll it started.
  const scrollingTo = useRef<string | null>(null);

  /**
   * The block whose prose is open for writing, and what was selected in it when
   * it opened — a caret when the two ends are equal.
   */
  const [editingProse, setEditingProse] = useState<{
    id: string;
    selection: { anchor: number; focus: number };
  } | null>(null);
  const spelling = useSpelling();

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

  const saveProse = useCallback(
    async (blockId: string, doc: ProseDoc) => {
      const { block } = await api.updateBlock(blockId, {
        content: doc as unknown as Record<string, unknown>,
      });
      // The word count is derived on the server, so the block that comes back
      // is the authority — including for the outline's totals.
      setBlocks((current) => current.map((b) => (b.id === blockId ? block : b)));
    },
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    localStorage.setItem(MODE_KEY, mode);
  }, [mode]);

  // Written both places: the browser so the next first paint is right, the
  // server so it is right on every other machine too. Held back until the
  // server's own answer has arrived, or the default would overwrite it in the
  // moment between the first render and the response.
  const scaleLoaded = useRef(false);

  useEffect(() => {
    void (async () => {
      try {
        const { preferences } = await api.getPreferences();
        if (preferences.textScale !== undefined) {
          setScaleIndex(stepForScale(preferences.textScale));
        }
      } finally {
        scaleLoaded.current = true;
      }
    })();
  }, []);

  useEffect(() => {
    if (!scaleLoaded.current) return;
    const scale = SCALE_STEPS[scaleIndex] ?? DEFAULT_SCALE;
    localStorage.setItem(SCALE_KEY, String(scale));
    void api.savePreferences({ textScale: scale }).catch(() => {
      // The browser's copy still holds; a failed save is not worth interrupting
      // the writing for.
    });
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

  // Outside zen the outline is always shown; inside zen it retracts to an edge
  // and slides back out when the pointer reaches it. Declared here because the
  // effects below depend on it.
  const showPanel = zen || phone ? panelOpen : true;

  // Rotating a phone, or narrowing a window, must not strand the writer in a
  // mode whose only exits are a key they haven't got and a control no longer
  // offered.
  useEffect(() => {
    if (phone && zen) setZen(false);
  }, [phone, zen]);

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

  /**
   * Typeset punctuation is a property of the block's format, so the editor has
   * to be told the same answer the renderer already worked out rather than
   * guessing at it.
   */
  const smartPunctuationFor = useCallback(
    (blockId: string) => {
      const item = items.find((i) => i.kind === "block" && i.block.id === blockId);
      return item && item.kind === "block" ? (item.smartPunctuation ?? false) : false;
    },
    [items],
  );

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
        // Smartened where the format smartens it, so the tally counts what is
        // on the page rather than what is in the column behind it.
        .map((i) =>
          i.kind === "block"
            ? {
                id: i.block.id,
                contentText: i.smartPunctuation
                  ? smartenText(i.block.contentText)
                  : i.block.contentText,
              }
            : null,
        )
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
    // The top of the section means the top of its break, when it has one — a
    // chapter starts at "Chapter Nine", not at the first line beneath it.
    const target =
      blockRefs.current.get(breakRefKey(blockId)) ?? blockRefs.current.get(blockId);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Backstop only: normally the hold is released on arrival. This covers a
    // scroll that never gets there — a target already at the top, so nothing
    // moves and no scroll event ever fires.
    window.setTimeout(() => {
      if (scrollingTo.current === blockId) scrollingTo.current = null;
    }, 1200);
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
  /**
   * Which block the top of the pane is inside.
   *
   * The decision itself is `currentBlockAt`, which is pure and tested; this
   * only supplies the measurements. It replaced a hit test — asking the browser
   * what is painted at a point — which had a hole at exactly the place a reader
   * starts: the pane is padded and the sheet inside it is padded again, so for
   * the first inch of the document that point lands on empty margin and finds
   * no block at all. The highlight didn't move until enough had scrolled past
   * to reach it, which is why tracking seemed to need a moment to wake up.
   */
  useEffect(() => {
    const pane = paneEl;
    if (!pane) return;

    let frame = 0;
    const update = () => {
      frame = 0;

      const rect = pane.getBoundingClientRect();

      // Read straight off the rendered document. Every block and every break
      // already carries its id as an attribute, and querying them returns them
      // in document order, which is the order they are read in.
      const positions: { id: string; top: number }[] = [];
      for (const el of pane.querySelectorAll<HTMLElement>("[data-block-id],[data-break-for]")) {
        const id = el.dataset.blockId ?? el.dataset.breakFor;
        if (id) positions.push({ id, top: el.getBoundingClientRect().top });
      }

      const next = currentBlockAt(positions, rect.top + 4);

      if (!next) return;

      // A click drives a smooth scroll, during which the top of the pane passes
      // over every block in between. Updates are held until it arrives — and
      // released the moment it does, rather than after a fixed wait that a long
      // scroll outlives and a short one sits through.
      if (scrollingTo.current) {
        if (scrollingTo.current !== next) return;
        scrollingTo.current = null;
      }

      setSelectedId((current) => (current === next ? current : next));

      // The active result follows the reading position, so stepping onward
      // means the next one down the page rather than one back from wherever you
      // last clicked. Marks render in the order the matches were found, so the
      // nth mark in the document is the nth match.
      if (!queryRef.current.trim()) return;
      const marks = pane.querySelectorAll("mark.hit");

      // While the current result is still on screen it stays the current one.
      // Without this the two rules fought: stepping centred a hit, this then
      // re-anchored to whichever hit was highest in view — an earlier one, when
      // several sit close together — and Next walked backwards for ever. The
      // reader can see the match they are on; nothing is gained by moving off it.
      const active = marks[matchIndexRef.current];
      if (active) {
        const box = active.getBoundingClientRect();
        if (box.bottom >= rect.top && box.top <= rect.bottom) return;
      }

      // Scrolled away from it: pick up again at the first one in view.
      for (let i = 0; i < marks.length; i += 1) {
        const mark = marks[i];
        if (!mark) continue;
        if (mark.getBoundingClientRect().top >= rect.top) {
          fromScroll.current = true;
          setMatchIndex((current) => (current === i ? current : i));
          break;
        }
      }
    };

    const onScroll = (event: Event) => {
      // Only the manuscript moving means the reading position changed. This
      // listener is on the document, so it also hears the outline scrolling
      // itself to follow — which must not be read back as the document moving,
      // or the two chase each other.
      const target = event.target;
      if (target instanceof Node && target !== pane && !target.contains(pane)) return;
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    // Captured on the document rather than bound to the pane. Scroll events
    // don't bubble, but they are dispatched through the capture phase, so this
    // hears whichever element actually scrolled — which removes the standing
    // assumption that the pane is the scroller. If a layout change ever moves
    // the scrolling to an ancestor, this keeps working.
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll);
    // The first paint may not have laid the manuscript out yet.
    const settle = window.setTimeout(update, 0);

    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
      window.clearTimeout(settle);
      if (frame) window.cancelAnimationFrame(frame);
    };
    // Once the pane exists, and only then. It reads the document rather than
    // any rendered value, so nothing else here can go stale — and depending on
    // `items` instead meant tearing down the listener and cancelling a pending
    // measurement every time the manuscript was touched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneEl]);

  // Centre the current block in the outline, so there is always context above
  // and below it rather than it sitting against an edge. Also runs when the
  // panel comes back into view: it can't scroll while it's retracted, so it
  // would otherwise reappear showing wherever it was left.
  useEffect(() => {
    if (!selectedId || !showPanel) return;
    const card = outlineRefs.current.get(selectedId);
    if (!card) return;

    // Deliberately not `scrollIntoView`. That scrolls *every* scrollable
    // ancestor, including the window — which moves the manuscript pane the
    // tracker measures from, so following the document changed what the
    // document appeared to be showing. Its smooth animation was the other half
    // of the trouble: a continuous scroll changes the current block every few
    // hundred milliseconds, and each call cancelled the last one mid-flight, so
    // the panel spent its time animating toward positions already stale.
    //
    // Setting scrollTop on the panel alone has neither problem: nothing else
    // moves, and each update lands before the next arrives.
    let panel: HTMLElement | null = card.parentElement;
    while (panel) {
      const overflow = window.getComputedStyle(panel).overflowY;
      if ((overflow === "auto" || overflow === "scroll") && panel.scrollHeight > panel.clientHeight) {
        break;
      }
      panel = panel.parentElement;
    }
    if (!panel) return;

    const cardBox = card.getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    const delta = cardBox.top + cardBox.height / 2 - (panelBox.top + panelBox.height / 2);
    if (Math.abs(delta) < 1) return;
    panel.scrollTop += delta;
  }, [selectedId, showPanel]);

  // Something is always current. The observer only speaks when a block crosses
  // its band, which never happens on first load — so the first block takes the
  // shade until scrolling says otherwise.
  useEffect(() => {
    if (selectedId) return;
    const first = entries[0]?.block.id;
    if (first) setSelectedId(first);
  }, [entries, selectedId]);

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
    setMatchIndex((matchIndex + delta + matches.length) % matches.length);
  };

  /**
   * Scroll to the hit itself rather than to the block holding it. Several
   * matches often share a block, and scrolling to the block would leave the
   * page motionless while the active mark moved somewhere off screen.
   */
  useEffect(() => {
    if (!activeMatch) return;
    if (fromScroll.current) {
      fromScroll.current = false;
      return;
    }
    const id = window.requestAnimationFrame(() => {
      paneRef.current
        ?.querySelector("mark.hit.active")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(id);
  }, [activeMatch]);

  async function moveBlock(blockId: string, parentId: string | null, afterId: string | null) {
    try {
      await api.moveBlock(blockId, parentId, afterId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not move that block");
    }
  }

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



  return (
    <div className={`work-shell${zen ? " zen" : ""}`}>
      <header className="app-header">
        <button
          className="btn ghost work-panel-toggle"
          type="button"
          aria-expanded={showPanel}
          aria-label={showPanel ? "Hide the outline" : "Show the outline"}
          title="Outline"
          onClick={() => setPanelOpen((open) => !open)}
        >
          {showPanel ? <X size={17} /> : <PanelLeft size={17} />}
        </button>
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

        <TextSize scaleIndex={scaleIndex} setScaleIndex={setScaleIndex} />

        <SearchBar
          open={searchOpen}
          query={query}
          matches={matches}
          activeIndex={matchIndex}
          onOpen={() => setSearchOpen(true)}
          onClose={() => {
            setSearchOpen(false);
            setQuery("");
          }}
          onQuery={setQuery}
          onStep={stepMatch}
        />

        <ThemeToggle />

        {/* Not offered on a phone. Zen trades chrome for manuscript, and a
            phone has almost no chrome to trade — the header is already the
            whole of it, and Escape, which is how you leave, is a key it
            hasn't got. */}
        {phone ? null : (
          <button
            className="btn ghost"
            type="button"
            title="Zen — hide everything but the manuscript (Esc to leave)"
            onClick={() => setZen(true)}
          >
            <Maximize2 size={16} />
          </button>
        )}
      </header>

      {error ? <div className="alert error work-error">{error}</div> : null}

      <div className={`work-body${showPanel ? "" : " panel-hidden"}`}>
        <aside
          className={`outline-panel${zen ? " floating" : " docked"}`}
          // Hovering the retracted edge brings it back, which is only a gesture
          // a pointer has. A phone gets the button in the header instead.
          onMouseEnter={() => zen && !phone && setPanelOpen(true)}
          onMouseLeave={() => zen && !phone && setPanelOpen(false)}
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
            <span className="spacer" />
            {/* Kept clear of the panel's right edge: retracted, that edge is the
                only strip still on screen, and the count would show through. */}
            <span className="outline-words">{wordFmt.format(totalWords)} words</span>
          </div>
          <OutlinePanel
            entries={entries}
            templates={templateMap}
            levels={levels}
            selectedId={selectedId}
            collapsed={collapsed}
            onToggleCollapse={toggleCollapse}
            onSelect={(id) => {
              selectAndScroll(id);
              // The sheet covers the manuscript, so choosing where to go means
              // wanting to see it rather than the list it was chosen from.
              if (phone) setPanelOpen(false);
            }}
            breaks={breaks}
            onSelectBreak={scrollToBreak}
            onAdd={(relativeTo, placement) => setAdding({ relativeTo, placement })}
            onRename={(blockId) => setRenaming(blocks.find((b) => b.id === blockId) ?? null)}
            onEditFormat={(blockId) =>
              setEditingFormat(blocks.find((b) => b.id === blockId) ?? null)
            }
            onOptions={(blockId) =>
              setEditingOptions(blocks.find((b) => b.id === blockId) ?? null)
            }
            onDelete={(blockId) => void onDelete(blockId)}
            registerRef={registerOutlineRef}
            onMove={(blockId, parentId, afterId) => void moveBlock(blockId, parentId, afterId)}
          />

          {/* Account and navigation live at the foot of the outline, out of the
              way of the manuscript rather than crowding the title bar. */}
          <div className="outline-foot">
            <Link className="btn ghost" to="/" title="Back to library">
              <ArrowLeft size={15} />
            </Link>
            <Link className="btn ghost" to={`/settings?work=${id}`} title="Settings">
              <Settings size={15} />
            </Link>
            <div className="spacer" />
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

        <main className="document-pane" ref={attachPane}>
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
            baseTypography={
              templates.find((t) => t.builtinKey === "regular-text")?.formatSettings?.typography ??
              null
            }
            bookmarkedBlockIds={new Set(bookmarks.map((b) => b.blockId))}
            onDropBookmark={(blockId) => void addBookmark(blockId)}
            search={foldForSearch(query.trim())}
            activeMatch={activeMatch}
            editingId={editingProse?.id ?? null}
            onEditProse={(blockId, selection) => {
              setSelectedId(blockId);
              setEditingProse({ id: blockId, selection });
            }}
            editor={(layout) =>
              editingProse ? (
                <ProseEditor
                  layout={layout}
                  spellcheckWanted={spelling.enabled}
                  // A fresh editor per block. Reusing one across a switch would
                  // leave the outgoing block's debounced save holding the
                  // incoming block's text.
                  key={editingProse.id}
                  blockId={editingProse.id}
                  initialSelection={editingProse.selection}
                  content={blocks.find((b) => b.id === editingProse.id)?.content ?? null}
                  fallbackText={blocks.find((b) => b.id === editingProse.id)?.contentText ?? ""}
                  speller={spelling.speller}
                  smartPunctuation={smartPunctuationFor(editingProse.id)}
                  onSave={(doc) => void saveProse(editingProse.id, doc)}
                  onDone={() => setEditingProse(null)}
                  onAddWord={(word) => void spelling.addWord(word)}
                  onIgnoreWord={spelling.ignoreWord}
                />
              ) : null
            }
          />
          {zen ? (
            // One cluster that fades in together, rather than controls scattered
            // down the page. Held open while a search is running: the results
            // count is part of what you are reading at that moment.
            <div className={`zen-controls${searchOpen ? " revealed" : ""}`}>
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

              <SearchBar
                open={searchOpen}
                query={query}
                matches={matches}
                activeIndex={matchIndex}
                onOpen={() => setSearchOpen(true)}
                onClose={() => {
                  setSearchOpen(false);
                  setQuery("");
                }}
                onQuery={setQuery}
                onStep={stepMatch}
              />

              <ThemeToggle />

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

      {editingOptions ? (
        <BlockOptionsEditor
          block={editingOptions}
          hasBreak={breaks.has(editingOptions.id)}
          onClose={() => setEditingOptions(null)}
          onSaved={() => {
            setEditingOptions(null);
            void load();
          }}
        />
      ) : null}

      {editingFormat ? (
        <FormatEditor
          work={work}
          block={editingFormat}
          template={templateMap.get(editingFormat.formatId) ?? null}
          onClose={() => setEditingFormat(null)}
          onSaved={() => {
            setEditingFormat(null);
            void load();
          }}
        />
      ) : null}

      {editingBreak ? (
        <BreakEditor
          work={work}
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

const workMeta = (work: Work) => ({
  title: work.title,
  subtitle: work.subtitle,
  authorFirstName: work.authorFirstName,
  authorLastName: work.authorLastName,
});

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
  work,
  block,
  onClose,
  onSaved,
}: {
  work: Work;
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
  const [savedFlash, flashSaved] = useSavedFlash(900);
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
      // Let the confirmation land before the window goes: closing instantly
      // leaves you unsure whether anything happened.
      flashSaved();
      window.setTimeout(onSaved, 600);
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

        <div className="modal-body">
          {detached && body ? (
            <FormatFields
              styleOnly={false}
              body={body}
              onBody={setBody}
              typography={{}}
              onTypography={() => {}}
              work={workMeta(work)}
            />
          ) : (
            <p className="muted" style={{ marginBottom: 18 }}>
              Nothing here is editable until you detach it.
            </p>
          )}
        </div>

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
            <button
              className={`btn${savedFlash ? " saved" : ""}`}
              type="button"
              onClick={() => void save()}
              disabled={busy}
            >
              {savedFlash ? (
                <>
                  <Check size={15} /> Saved!
                </>
              ) : busy ? (
                "Saving…"
              ) : (
                "Save"
              )}
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

/**
 * Edits the format of one block.
 *
 * A format template is shared, so changing it in Settings changes every block
 * using it — right for a house style, wrong for one particular title page.
 * Editing here detaches: the body is copied onto the block and from then on it
 * renders its own, exactly as breaks do.
 */
function FormatEditor({
  work,
  block,
  template,
  onClose,
  onSaved,
}: {
  work: Work;
  block: Block;
  template: Template | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialogs = useDialogs();
  const templateName = template?.name ?? "this format";
  // The same split Settings makes: a format whose body is only the content slot
  // has no arrangement, so it edits as type rather than as layout.
  const nodes = template?.body.nodes ?? [];
  const styleOnly = nodes.length === 1 && nodes[0]?.type === "content";

  const [body, setBody] = useState<TemplateBody | null>(block.formatBody ?? null);
  const [typo, setTypo] = useState<Typography>(block.formatTypography ?? {});
  const [detached, setDetached] = useState(
    Boolean(block.formatBody || block.formatTypography),
  );
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, flashSaved] = useSavedFlash(900);
  const [busy, setBusy] = useState(false);

  async function detach() {
    setError(null);
    setBusy(true);
    try {
      const { block: updated } = await api.detachFormat(block.id);
      setBody(updated.formatBody ?? { nodes: [] });
      setTypo(updated.formatTypography ?? {});
      setDetached(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not detach this format");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await api.updateFormat(
        block.id,
        styleOnly ? { typography: typo } : { body: body ?? { nodes: [] } },
      );
      flashSaved();
      window.setTimeout(onSaved, 600);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not save");
      setBusy(false);
    }
  }

  async function revert() {
    const ok = await dialogs.confirm({
      title: "Follow the template again?",
      message: `This block's edits will be discarded and it will render through ${templateName} like every other block using it.`,
      confirmLabel: "Discard edits",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.revertFormat(block.id);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not revert");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2 className="card-title">Format for this block</h2>
        <p className="card-subtitle">
          {detached
            ? `Edited for this block alone. Other blocks using ${templateName} are untouched.`
            : `This block renders through ${templateName}, shared with every other block using it. Edit it to make this one its own.`}
        </p>

        {error ? <div className="alert error">{error}</div> : null}

        <div className="modal-body">
          {detached ? (
            <FormatFields
              styleOnly={styleOnly}
              body={body ?? { nodes: [] }}
              onBody={setBody}
              typography={typo}
              onTypography={setTypo}
              work={workMeta(work)}
            />
          ) : (
            <p className="muted" style={{ marginBottom: 18 }}>
              Nothing here is editable until you detach it.
            </p>
          )}
        </div>

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
            <button
              className={`btn${savedFlash ? " saved" : ""}`}
              type="button"
              onClick={() => void save()}
              disabled={busy || !body}
            >
              {savedFlash ? (
                <>
                  <Check size={15} /> Saved!
                </>
              ) : busy ? (
                "Saving…"
              ) : (
                "Save"
              )}
            </button>
          ) : (
            <button className="btn" type="button" onClick={() => void detach()} disabled={busy}>
              {busy ? "Detaching…" : "Edit just this block"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Decisions about one block rather than about the format it renders through.
 * All three default to carrying on, so a manuscript that sets none of them
 * behaves as though they didn't exist.
 */
function BlockOptionsEditor({
  block,
  hasBreak,
  onClose,
  onSaved,
}: {
  block: Block;
  hasBreak: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [options, setOptions] = useState<BlockOptions>(block.options ?? {});
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, flashSaved] = useSavedFlash(900);
  const [busy, setBusy] = useState(false);

  const set = (patch: Partial<BlockOptions>) => setOptions({ ...options, ...patch });

  async function save() {
    setBusy(true);
    try {
      await api.updateBlock(block.id, { options });
      flashSaved();
      window.setTimeout(onSaved, 600);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not save");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="card-title">Block options</h2>
        <p className="card-subtitle">
          {block.label ? `“${block.label}”` : "This block"} — settings for this block alone.
        </p>

        {error ? <div className="alert error">{error}</div> : null}

        <div className="field">
          <label className="field-label">Word count</label>
          <select
            value={options.wordCount ?? "continue"}
            onChange={(e) => set({ wordCount: e.target.value as "continue" | "restart" })}
          >
            <option value="continue">Continue the running count</option>
            <option value="restart">Start a new count here</option>
          </select>
        </div>

        <label className="check" style={{ marginBottom: 16 }}>
          <input
            type="checkbox"
            disabled={!hasBreak}
            checked={options.countBreakWords ?? false}
            onChange={(e) => set({ countBreakWords: e.target.checked })}
          />
          <span>
            Count the attached break&rsquo;s words{" "}
            <em>{hasBreak ? "— off by default; a heading isn't prose" : "— this block has no break"}</em>
          </span>
        </label>

        <div className="field">
          <label className="field-label">Page numbering</label>
          <select
            value={options.pageNumbering ?? "continue"}
            onChange={(e) => set({ pageNumbering: e.target.value as "continue" | "restart" })}
          >
            <option value="continue">Continue from the previous page</option>
            <option value="restart">Restart the page count here</option>
          </select>
          {options.pageNumbering === "restart" ? (
            <>
              <label className="field-label" style={{ marginTop: 10 }}>
                Starting at
              </label>
              <input
                type="number"
                min={1}
                value={options.startPageNumber ?? 1}
                onChange={(e) => set({ startPageNumber: Number(e.target.value) || 1 })}
              />
            </>
          ) : null}
          <p className="field-hint">
            Page numbers become real at export; the manuscript marks the boundary here.
          </p>
        </div>

        <div className="modal-actions">
          <button
            className="btn ghost"
            type="button"
            onClick={() => setOptions({})}
            disabled={Object.keys(options).length === 0}
          >
            Reset to defaults
          </button>
          <div className="spacer" />
          <button className="btn secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn${savedFlash ? " saved" : ""}`}
            type="button"
            onClick={() => void save()}
            disabled={busy}
          >
            {savedFlash ? (
              <>
                <Check size={15} /> Saved!
              </>
            ) : busy ? (
              "Saving…"
            ) : (
              "Save"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
