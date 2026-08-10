import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  LayoutGrid,
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
import {
  buildOutline,
  currentBlockAt,
  deriveDocument,
  foldForSearch,
  smartenText,
  subtreeWordCounts,
} from "@brigid/shared";
import type { BlockOptions, CanvasNode, ProseDoc, TemplateBody, Typography } from "@brigid/shared";
import { ApiError, api } from "../api.js";
import type { Block, Bookmark, Placement, Template, Work, WorkLevel } from "../api.js";
import { BrandMark } from "../components/Brand.js";
import { CanvasView } from "../components/CanvasView.js";
import { DocumentView, breakRefKey } from "../components/DocumentView.js";
import type { ViewMode } from "../components/DocumentView.js";
import { BookmarkStrip } from "../components/BookmarkStrip.js";
import { FormatFields } from "../components/FormatFields.js";
import { useDialogs } from "../components/Dialogs.js";
import { SearchBar, findMatches } from "../components/SearchBar.js";
import type { SearchMatch } from "../components/SearchBar.js";
import { ThemeToggle } from "../components/ThemeToggle.js";
import { useSavedFlash } from "../useSavedFlash.js";
import { OutlinePanel } from "../components/OutlinePanel.js";
import { ProseEditor } from "../components/ProseEditor.js";
import { isCheckable, useSpelling, words } from "../spelling.js";
import { useAuth } from "../auth/AuthContext.js";
import { PHONE, useMediaQuery } from "../useMediaQuery.js";
import {
  SessionPill,
  pauseSession,
  readSession,
  recordChange,
  resumeSession,
  writeSession,
} from "../components/SessionGoal.js";
import type { Session } from "../components/SessionGoal.js";
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

  /**
   * A writing session, if one is running. Kept in the browser: it is a sitting
   * at a desk rather than a fact about the manuscript, and it should survive a
   * reload without following the writer to another machine.
   */
  const [session, setSession] = useState<Session | null>(() => readSession());

  const changeSession = useCallback((next: Session | null) => {
    setSession(next);
    writeSession(next);
  }, []);

  /**
   * The clock runs while the manuscript is open, and stops when it isn't.
   *
   * Leaving for the settings or the library is not writing. Unmounting is what
   * that leaving looks like from here, so the session is banked on the way out
   * — paused, never cancelled, because it is still yours when you come back.
   */
  useEffect(() => {
    return () => {
      const current = readSession();
      if (current) writeSession(pauseSession(current));
    };
  }, []);
  /**
   * The browser's own copy, read before anything is fetched so the manuscript
   * opens in the right shape rather than flicking into it. "reading" was an
   * earlier name for the manuscript mode; map it forward so an existing browser
   * doesn't come back to a mode that no longer exists.
   */
  const [mode, setMode] = useState<ViewMode>(() => {
    const held = localStorage.getItem(MODE_KEY);
    if (held === "manuscript" || held === "reading") return "manuscript";
    if (held === "canvas") return "canvas";
    return "book";
  });
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
  /**
   * Until when the scroll tracker should keep quiet.
   *
   * A smooth scroll is an animation: it fires scroll events the whole way, and
   * the tracker reads each one as "the writer moved the page" and resets the
   * match to whatever is passing by. That is the bounce — stepping forward
   * scrolled toward the next hit, the tracker caught the page mid-flight and
   * put the index back, and the next press started the same journey again.
   *
   * `fromScroll` cannot cover this: it is a one-shot flag for the opposite
   * direction, and one flag cannot suppress a stream of events. A deadline can.
   */
  const scrollingUntil = useRef(0);
  // The tracker below runs off a listener bound once, so it reads the current
  // index here rather than closing over a stale one.
  const matchIndexRef = useRef(0);
  matchIndexRef.current = matchIndex;
  const queryRef = useRef("");
  queryRef.current = query;
  const [activeBookmark, setActiveBookmark] = useState<string | null>(null);
  const [adding, setAdding] = useState<AddRequest | null>(null);
  const [renaming, setRenaming] = useState<Block | null>(null);

  /**
   * Working on the manuscript is not writing it.
   *
   * Renaming a section, editing a title page, setting a break, adding a block:
   * all of it is worth doing and none of it is the thing the clock is counting.
   * Paused rather than cancelled, and not resumed when the dialog closes —
   * typing is what starts it again, and closing a dialog is not typing.
   */
  const editingSomething =
    adding !== null ||
    renaming !== null ||
    editingBreak !== null ||
    editingFormat !== null ||
    editingOptions !== null;

  useEffect(() => {
    if (!editingSomething) return;
    setSession((current) => {
      if (!current || current.since === null) return current;
      const stopped = pauseSession(current);
      writeSession(stopped);
      return stopped;
    });
  }, [editingSomething]);

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
    /** Set when a misspelled word was clicked, so the editor opens on it. */
    askAbout?: string;
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
      // What this block was worth before the save, so the change can be counted
      // as movement rather than only as a new total.
      const before = blocks.find((b) => b.id === blockId)?.wordCount ?? 0;
      const { block } = await api.updateBlock(blockId, {
        content: doc as unknown as Record<string, unknown>,
      });

      const delta = block.wordCount - before;
      if (delta !== 0) {
        setSession((current) => {
          if (!current) return current;
          const counted = recordChange(current, delta);
          writeSession(counted);
          return counted;
        });
      }
      // The word count is derived on the server, so the block that comes back
      // is the authority — including for the outline's totals.
      setBlocks((current) => current.map((b) => (b.id === blockId ? block : b)));
    },
    [blocks],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Written both places: the browser so the next first paint is right, the
  // server so it is right on every other machine too. Held back until the
  // server's own answer has arrived, or the default would overwrite it in the
  // moment between the first render and the response.
  /**
   * Where the reader was, across a change of text size.
   *
   * Resizing reflows the whole manuscript, so the scroll offset that had you at
   * chapter nine now has you somewhere else entirely — the further in, the
   * further it throws you. Nobody changes text size in order to go somewhere;
   * they change it to read the same passage more comfortably.
   *
   * So the block nearest the top of the view is noted with its distance from
   * that edge, and after the reflow the page is scrolled to put it back exactly
   * there. A block rather than a paragraph: it is what the document already
   * marks in the DOM, and at this granularity a line or two of drift is
   * invisible while a chapter of drift is the whole problem.
   */
  const holdPosition = useRef<{ blockId: string; fromTop: number } | null>(null);

  const rememberPosition = useCallback(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const edge = pane.getBoundingClientRect().top;
    for (const el of pane.querySelectorAll<HTMLElement>("[data-block-id]")) {
      const box = el.getBoundingClientRect();
      // The first block still on screen: its bottom has not passed the top edge.
      if (box.bottom > edge) {
        const blockId = el.dataset.blockId;
        if (blockId) holdPosition.current = { blockId, fromTop: box.top - edge };
        return;
      }
    }
  }, []);

  /**
   * Restored after the browser has laid the new size out, not after React has
   * rendered it — a layout effect would measure the old boxes.
   */
  useEffect(() => {
    const held = holdPosition.current;
    if (!held) return;
    holdPosition.current = null;

    const id = window.requestAnimationFrame(() => {
      const pane = paneRef.current;
      const el = pane?.querySelector<HTMLElement>(`[data-block-id="${held.blockId}"]`);
      if (!pane || !el) return;
      const moved = el.getBoundingClientRect().top - pane.getBoundingClientRect().top - held.fromTop;
      // Whatever is actually scrolling: the pane in one view, the window in the
      // other. Asking both and letting the one that cannot move ignore it is
      // simpler than working out which is which.
      pane.scrollBy({ top: moved });
      window.scrollBy({ top: moved });
    });
    return () => window.cancelAnimationFrame(id);
  }, [scaleIndex]);

  const scaleLoaded = useRef(false);

  useEffect(() => {
    void (async () => {
      try {
        const { preferences } = await api.getPreferences();
        if (preferences.textScale !== undefined) {
          setScaleIndex(stepForScale(preferences.textScale));
        }
        /**
         * Only when this browser has no opinion of its own. Someone who just
         * switched to the canvas here should not be moved back because another
         * machine last saved something else.
         */
        if (preferences.viewMode && !localStorage.getItem(MODE_KEY)) {
          setMode(preferences.viewMode);
        }
      } finally {
        scaleLoaded.current = true;
        modeLoaded.current = true;
      }
    })();
  }, []);

  /**
   * Kept in both places, for the two different jobs. The browser's copy is what
   * makes the next visit open in the right shape immediately; the server's is
   * what carries the choice to another machine.
   */
  const modeLoaded = useRef(false);
  useEffect(() => {
    localStorage.setItem(MODE_KEY, mode);
    if (!modeLoaded.current) return;
    void api.savePreferences({ viewMode: mode }).catch(() => {
      // The browser's copy still holds; a failed save is not worth interrupting
      // the writing for.
    });
  }, [mode]);

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

  /**
   * Where blocks sit on the canvas. Positions only — the outline still decides
   * order and nesting, which is what lets the arrows be derived rather than
   * stored, and redraw the moment anything is reordered.
   */
  const [canvasNodes, setCanvasNodes] = useState<CanvasNode[]>([]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    void api
      .getCanvas(id)
      .then(({ nodes }) => {
        if (alive) setCanvasNodes(nodes);
      })
      .catch(() => {
        // An unplaced canvas lays itself out; a failed read is not worth an
        // error over a view the writer may never open.
      });
    return () => {
      alive = false;
    };
  }, [id]);

  /**
   * Moving something. Held locally at once so the drag is smooth, and written
   * back — a drag is a stream of these, so the save is debounced rather than
   * one request per frame.
   */
  const placeSave = useRef<number | null>(null);
  /**
   * Everything moved since the last write, gathered rather than replaced.
   *
   * A drag is a stream of these, so they are debounced — but debouncing the
   * *batch* threw work away: move a chapter and then a scene inside the same
   * few hundred milliseconds and only the scene reached the server, while the
   * chapter sat correct on screen until the page was next loaded. Merged by
   * block, so the last word on each is kept and none is dropped.
   */
  const pendingPlaces = useRef<Map<string, CanvasNode>>(new Map());

  const placeNodes = useCallback(
    (moved: CanvasNode[]) => {
      if (moved.length === 0) return;
      setCanvasNodes((held) => {
        const by = new Map(held.map((n) => [n.blockId, n]));
        for (const n of moved) by.set(n.blockId, n);
        return [...by.values()];
      });

      for (const n of moved) pendingPlaces.current.set(n.blockId, n);

      if (placeSave.current) window.clearTimeout(placeSave.current);
      placeSave.current = window.setTimeout(() => {
        const batch = [...pendingPlaces.current.values()];
        pendingPlaces.current.clear();
        if (id && batch.length > 0) {
          void api.saveCanvas(id, batch).catch(() => {
            // Put them back, so a failed write is retried with the next move
            // rather than quietly losing an arrangement.
            for (const n of batch) pendingPlaces.current.set(n.blockId, n);
          });
        }
      }, 400);
    },
    [id],
  );

  /**
   * A drag left in flight when the view changes, or the tab closes, would
   * otherwise never be written: the timer dies with the component.
   */
  useEffect(() => {
    const flush = () => {
      const batch = [...pendingPlaces.current.values()];
      pendingPlaces.current.clear();
      if (id && batch.length > 0) void api.saveCanvas(id, batch).catch(() => undefined);

      const notes = [...pendingNotes.current.entries()];
      pendingNotes.current.clear();
      for (const [bid, at] of notes) {
        void api.editBookmark(bid, { noteX: at.x, noteY: at.y }).catch(() => undefined);
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [id]);

  /**
   * A note moved on the canvas.
   *
   * Held on screen at once and written a moment later, the same as a block: a
   * drag is a stream of positions, and a request for each would be a request a
   * frame. Batched in a map keyed by note, so the last position of each wins
   * and a slow write cannot lose a later move.
   */
  const pendingNotes = useRef<Map<string, { x: number; y: number }>>(new Map());
  const noteSave = useRef<number | null>(null);

  const moveNote = useCallback((bookmarkId: string, x: number, y: number) => {
    setBookmarks((held) =>
      held.map((b) => (b.id === bookmarkId ? { ...b, noteX: x, noteY: y } : b)),
    );
    pendingNotes.current.set(bookmarkId, { x, y });

    if (noteSave.current) window.clearTimeout(noteSave.current);
    noteSave.current = window.setTimeout(() => {
      const batch = [...pendingNotes.current.entries()];
      pendingNotes.current.clear();
      for (const [bid, at] of batch) {
        void api.editBookmark(bid, { noteX: at.x, noteY: at.y }).catch(() => {
          // Put it back, so a failed write is retried with the next move rather
          // than quietly losing where the note was put.
          pendingNotes.current.set(bid, at);
        });
      }
    }, 400);
  }, []);

  /** What the canvas needs to draw a block: the card, as the outline shows it. */
  const canvasTotals = useMemo(() => subtreeWordCounts(entries), [entries]);

  /**
   * Whether a block stands at a level in the book, rather than being front
   * matter that happens to sit among them. A title page is not a chapter and
   * has no length it is meant to reach.
   */
  const structural = useCallback(
    (block: Block) =>
      templates.find((t) => t.id === block.formatId)?.formatSettings?.structural ?? true,
    [templates],
  );

  const canvasItems = useMemo(
    () =>
      entries.map((entry) => ({
        block: entry.block,
        levelName: levels[entry.depth]?.name ?? "Section",
        words: canvasTotals.get(entry.block.id) ?? entry.block.wordCount,
        childCount: entry.childCount,
        breakName:
          levels[entry.depth]?.breakTemplateId && !entry.isFirstChild
            ? (templates.find((t) => t.id === levels[entry.depth]?.breakTemplateId)?.name ?? null)
            : null,
        // Only structural blocks: a title page has no length to fall short of,
        // so it is never shaded short and never shaded met.
        goal: structural(entry.block) ? (levels[entry.depth]?.wordGoal ?? null) : null,
      })),
    [entries, levels, templates, canvasTotals, structural],
  );


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
  const allMatches = useMemo(() => findMatches(searchable, query), [searchable, query]);

  /**
   * One entry per card rather than per occurrence, on the canvas.
   *
   * A canvas has no reading order to scroll along, so a result there is a
   * card: five hits in one chapter's opening is one place to be taken, not
   * five. Stepping and the tally both run off this list, so "3 of 6" means the
   * third of six cards.
   */
  const canvasMatches = useMemo(() => {
    const seen = new Set<string>();
    const out: SearchMatch[] = [];
    for (const m of allMatches) {
      if (seen.has(m.blockId)) continue;
      seen.add(m.blockId);
      out.push({ blockId: m.blockId, indexInBlock: 0 });
    }
    return out;
  }, [allMatches]);

  const matches = mode === "canvas" ? canvasMatches : allMatches;
  const activeMatch = matches[matchIndex] ?? null;

  /** Which cards hold the term, for lighting them where they sit. */
  const canvasHits = useMemo(
    () => new Set(canvasMatches.map((m) => m.blockId)),
    [canvasMatches],
  );

  /**
   * Which hit inside the block being edited is the current one.
   *
   * The editor draws one block and knows nothing of the rest, so it cannot work
   * out that a hit is "the fourth of eleven in the manuscript". It is told the
   * position within its own block instead, counted here where the whole list is
   * in view. Null when the active hit is somewhere else — or nowhere.
   */
  const activeHitInEditor = useMemo(() => {
    if (!editingProse || !activeMatch || activeMatch.blockId !== editingProse.id) return null;
    let n = 0;
    for (const match of allMatches) {
      if (match === activeMatch) return n;
      if (match.blockId === editingProse.id) n += 1;
    }
    return null;
  }, [allMatches, activeMatch, editingProse]);

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

      // Mid-flight on a scroll we asked for. Where the page happens to be
      // partway through does not mean the writer went there.
      if (Date.now() < scrollingUntil.current) return;

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

  /**
   * Move to the next hit, and leave the editor if one is open.
   *
   * Stepping through results is navigation, and the editor is effectively modal
   * over its block: it renders its own prose with none of the search
   * highlighting, so a hit inside the section being edited could be scrolled to
   * but never lit up, and stepping past it kept snapping back. Closing first
   * means every hit behaves the same way — highlighted, in place, and left
   * behind when you move on.
   *
   * Nothing is lost by closing. The editor saves as it goes, so leaving it is
   * the same act as clicking away from it, which is how it is usually left.
   */
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
      const pane = paneRef.current;
      if (!pane || !activeMatch) return;

      /**
       * Scrolled by hand, and deliberately.
       *
       * `scrollIntoView` is unreliable on an inline element, which a hit is —
       * that is the fault this replaced. Focusing the hit does scroll it, but
       * focus is also the keyboard, and this runs on every keystroke as the
       * match moves: it emptied the search box mid-word, and with a section
       * open it fought the editor for the caret.
       *
       * Measuring and scrolling the pane needs neither. It works for inline
       * elements, and it leaves whoever is typing exactly where they were.
       */
      const hit = pane.querySelector<HTMLElement>("mark.hit.active");
      const target =
        hit ??
        // No mark: the block is open in the editor, which renders its own prose
        // without the search highlighting. Nothing can be lit up, but the
        // passage can still be brought on screen.
        pane.querySelector<HTMLElement>(`[data-block-id="${activeMatch.blockId}"]`);
      if (!target) return;

      const paneBox = pane.getBoundingClientRect();
      const box = target.getBoundingClientRect();
      const delta = box.top - paneBox.top - Math.max(0, paneBox.height - box.height) / 2;
      // Already where it should be: a keystroke that leaves the match alone
      // must not nudge the page.
      if (Math.abs(delta) > 2) {
        // Long enough to cover the animation. Overshooting only means the
        // tracker resumes a moment late, which nobody can see; undershooting
        // means the bounce comes back.
        scrollingUntil.current = Date.now() + 800;
        pane.scrollBy({ top: delta, behavior: "smooth" });
      }
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

  /**
   * The line a bookmark marks, rather than the block containing it.
   *
   * The stored index is tried first, then checked against the snippet taken
   * when the bookmark was made. If they disagree, paragraphs have been added or
   * removed above and the snippet is what still identifies the place — so the
   * paragraph matching it wins, and failing that the block does, which is where
   * bookmarks have always landed.
   */
  function scrollToParagraph(bookmark: Bookmark): boolean {
    const block = paneRef.current?.querySelector(`[data-block-id="${bookmark.blockId}"]`);
    if (!block) return false;

    const paragraphs = [...block.querySelectorAll("p")];
    if (paragraphs.length === 0) return false;

    const wanted = (bookmark.paragraphText ?? "").trim();
    let target = paragraphs[bookmark.paragraphIndex ?? 0];

    if (wanted && (target?.textContent ?? "").trim().slice(0, wanted.length) !== wanted) {
      const moved = paragraphs.find((p) => (p.textContent ?? "").trim().startsWith(wanted));
      if (moved) target = moved;
    }

    if (!target) return false;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    return true;
  }

  /**
   * Carry a spelling pass into the next section.
   *
   * The editor knows only its own block, so it runs out at the end of a section
   * and stops — which reads as the pass having broken rather than as a section
   * being finished. Finding where to go next needs the whole manuscript, so it
   * is answered here.
   *
   * The next section holding something the checker does not know, in reading
   * order. Opened with that word already asked about, so the pass carries on
   * where it left off rather than making the writer find it again.
   */
  /**
   * Sections already offered during this pass.
   *
   * A section can hand the pass straight back — the page picks it by scanning
   * the plain text and the editor marks the rendered prose, and where those
   * disagree the editor arrives, finds nothing, and asks for the next one. Left
   * unbounded that walks the manuscript for ever once it wraps. Cleared when a
   * pass is started by hand.
   */
  const passTried = useRef<Set<string>>(new Set());

  const continueSpellingAfter = useCallback(
    (blockId: string | null) => {
      /**
       * Nothing can be found before the dictionary is here. Asking for it is
       * the useful response rather than doing nothing: it arrives in a moment,
       * and the writer can press again.
       */
      const speller = spelling.speller;
      if (!speller) {
        void spelling.reload();
        return;
      }

      const order = items.filter((i) => i.kind === "block");
      const from = blockId
        ? order.findIndex((i) => i.kind === "block" && i.block.id === blockId)
        : -1;

      /**
       * Everything after where we are, then everything before it. Wrapping
       * rather than stopping: a pass started halfway down should still reach
       * the beginning, and refusing to move because the rest happens to be
       * clean is not an answer anyone wants.
       */
      for (const item of [...order.slice(from + 1), ...order.slice(0, Math.max(0, from + 1))]) {
        if (item.kind !== "block") continue;
        if (item.block.id === blockId) continue;
        if (passTried.current.has(item.block.id)) continue;
        const flagged = words(item.block.contentText).find(
          (w) => isCheckable(w.word) && !speller.correct(w.word),
        );
        if (!flagged) continue;

        /**
         * The search is called off first.
         *
         * A query open closes any editor — that is what makes a hit inside an
         * edited section highlightable — so opening one here would have it shut
         * again in the same breath. Walking the misspellings and walking the
         * matches are two different passes, and starting one ends the other.
         */
        setQuery("");
        passTried.current.add(item.block.id);

        /**
         * Selected, not scrolled to.
         *
         * `selectAndScroll` glides the section into view, and the editor then
         * brings the word itself into view when it opens — but it measures
         * while that glide is still animating, so it scrolls by a delta taken
         * from a moving target and the two compound into a long overshoot.
         *
         * One scroll, aimed at the word rather than the section, which is the
         * more useful destination anyway.
         */
        setSelectedId(item.block.id);
        setEditingProse({
          id: item.block.id,
          selection: { anchor: 0, focus: 0 },
          askAbout: flagged.word,
        });
        return;
      }

      // Nothing further: the pass is finished, and closing says so more
      // plainly than a menu that refuses to open.
      passTried.current.clear();
      setEditingProse(null);
    },
    [items, spelling],
  );

  async function addBookmark(blockId: string, paragraph?: { index: number; text: string }) {
    try {
      const { bookmark } = await api.createBookmark(id, blockId, {
        ...(paragraph ? { paragraphIndex: paragraph.index, paragraphText: paragraph.text } : {}),
      });
      setBookmarks((prev) => [...prev, bookmark]);
      setActiveBookmark(bookmark.id);
      // Straight into naming it. A bookmark dropped and left with its fallback
      // name is one nobody can tell from the others a week later, and the
      // moment you know why you marked the place is this one.
      //
      // Cancelling here means "I didn't mean to make this", not "keep it
      // unnamed": the dialog opened by itself rather than being asked for, so
      // the only way to back out of an accidental drop is for cancel to undo
      // it. Cancelling a rename on an existing bookmark still just leaves it be.
      const named = await renameBookmark(bookmark);
      if (!named) await removeBookmark(bookmark, { confirm: false });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not add the bookmark");
    }
  }

  /** True when a name was saved, false when the writer backed out. */
  async function renameBookmark(bookmark: Bookmark): Promise<boolean> {
    const answer = await dialogs.prompt({
      title: "This bookmark",
      fields: [
        { label: "Name", value: bookmark.name },
        // What the name cannot hold: why this place was worth marking.
        { label: "Note (optional)", value: bookmark.description ?? "", rows: 4 },
      ],
    });
    if (!answer) return false;
    const name = answer[0]?.trim();
    if (!name) return false;
    try {
      const { bookmark: updated } = await api.editBookmark(bookmark.id, {
        name,
        // Empty clears it, which is the only way to take one back off.
        description: answer[1]?.trim() || null,
      });
      setBookmarks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not rename the bookmark");
      // Not a cancellation: the bookmark stands, and a failed save should not
      // take a just-dropped one away with it.
      return true;
    }
  }

  async function removeBookmark(bookmark: Bookmark, options?: { confirm?: boolean }) {
    /**
     * A bookmark is a note to yourself about a place, and the note is the part
     * that cannot be reconstructed — the place you could find again.
     *
     * Not asked when undoing a drop the writer has just cancelled out of. They
     * said no a moment ago, and asking again about a bookmark that never really
     * existed is noise.
     */
    const ok =
      options?.confirm === false ||
      (await dialogs.confirm({
        title: `Delete "${bookmark.name}"?`,
        message: bookmark.description
          ? `Its note goes with it: "${bookmark.description}"`
          : "The manuscript is not affected.",
        confirmLabel: "Delete",
        danger: true,
      }));
    if (!ok) return;
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
          <button
            type="button"
            aria-pressed={mode === "canvas"}
            onClick={() => setMode("canvas")}
            title="Canvas — the shape of the book, as nested regions"
          >
            <LayoutGrid size={13} /> Canvas
          </button>
        </div>

        <TextSize scaleIndex={scaleIndex} setScaleIndex={setScaleIndex} onResize={rememberPosition} />

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
          onNextMisspelling={
            spelling.enabled
              ? () => {
                  passTried.current.clear();
                  continueSpellingAfter(selectedId);
                }
              : undefined
          }
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

      <div className={`work-body${zen ? " zen" : ""}${showPanel ? "" : " panel-hidden"}`}>
        <aside
          className={`outline-panel${zen ? " floating" : " docked"}`}
          // Hovering the retracted edge brings it back, which is only a gesture
          // a pointer has. A phone gets the button in the header instead.
          onMouseEnter={() => zen && !phone && setPanelOpen(true)}
          onMouseLeave={() => zen && !phone && setPanelOpen(false)}
        >
          {/* Bookmarks and the outline's own title travel together at the top
              of the panel. Two sticky elements stacked would each need to know
              the other's height, and the bookmark strip's changes as it opens
              and closes — so they are one block that sticks. */}
          <div className="outline-top">
          <BookmarkStrip
            bookmarks={bookmarks}
            activeId={activeBookmark}
            onGo={(bookmark) => {
              setActiveBookmark(bookmark.id);
              /**
               * A line bookmark scrolls straight to its line. Doing the block
               * first and the line after was the obvious order and the wrong
               * one: the block scroll is smooth, so it was still animating when
               * the line scroll ran, and then finished on top of it — landing
               * at the top of the section every time, which is exactly what the
               * line was meant to improve on.
               */
              if (bookmark.paragraphIndex !== null && scrollToParagraph(bookmark)) {
                setSelectedId(bookmark.blockId);
              } else {
                selectAndScroll(bookmark.blockId);
              }
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
            <Link className="btn ghost" to={`/settings?work=${id}`} title="Settings and tools">
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

        <main
          className={`document-pane${mode === "canvas" ? " canvas-mode" : ""}`}
          ref={attachPane}
        >
          {mode === "canvas" ? (
            <CanvasView
              items={canvasItems}
              nodes={canvasNodes}
              selectedId={selectedId}
              query={query}
              hits={canvasHits}
              focusId={activeMatch?.blockId ?? null}
              bookmarks={bookmarks}
              onMoveNote={moveNote}
              onOpenNote={(bookmarkId) => {
                const note = bookmarks.find((b) => b.id === bookmarkId);
                if (note) void renameBookmark(note);
              }}
              onSelect={setSelectedId}
              onOpen={(blockId) =>
                setEditingProse({ id: blockId, selection: { anchor: 0, focus: 0 } })
              }
              onPlace={placeNodes}
              onReset={() => {
                if (!id) return;
                pendingPlaces.current.clear();
                setCanvasNodes([]);
                void api.resetCanvas(id).catch(() => undefined);
              }}
            />
          ) : (
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
            bookmarksByBlock={
              new Map(
                [...new Set(bookmarks.map((b) => b.blockId))].map((blockId) => [
                  blockId,
                  bookmarks
                    .filter((b) => b.blockId === blockId)
                    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
                ]),
              )
            }
            onDropBookmark={(blockId, paragraph) => void addBookmark(blockId, paragraph)}
            search={foldForSearch(query.trim())}
            activeMatch={activeMatch}
            speller={spelling.speller}
            editingId={editingProse?.id ?? null}
            onEditProse={(blockId, selection, askAbout) => {
              setSelectedId(blockId);
              setEditingProse({ id: blockId, selection, ...(askAbout ? { askAbout } : {}) });
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
                  askAbout={editingProse.askAbout}
                  search={query.trim() || undefined}
                  activeHit={activeHitInEditor}
                  // The block keeps its markers while it is being edited.
                  bookmarks={bookmarks.filter((b) => b.blockId === editingProse.id)}
                  onNoMoreHere={() => continueSpellingAfter(editingProse.id)}
                  content={blocks.find((b) => b.id === editingProse.id)?.content ?? null}
                  fallbackText={blocks.find((b) => b.id === editingProse.id)?.contentText ?? ""}
                  speller={spelling.speller}
                  smartPunctuation={smartPunctuationFor(editingProse.id)}
                  onSave={(doc) => {
                    void saveProse(editingProse.id, doc);
                    // Writing is what the clock is for, so writing starts it.
                    setSession((current) => {
                      if (!current || current.since !== null) return current;
                      const going = resumeSession(current);
                      writeSession(going);
                      return going;
                    });
                  }}
                  onDone={() => setEditingProse(null)}
                  onAddWord={(word) => void spelling.addWord(word)}
                  onIgnoreWord={spelling.ignoreWord}
                />
              ) : null
            }
          />
          )}
          {session ? (
            <SessionPill
              session={session}
              totalWords={totalWords}
              onChange={changeSession}
            />
          ) : null}

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
                <button
                  type="button"
                  aria-pressed={mode === "canvas"}
                  onClick={() => setMode("canvas")}
                  title="Canvas — the shape of the book, as nested regions"
                >
                  <LayoutGrid size={13} /> Canvas
                </button>
              </div>

              <TextSize scaleIndex={scaleIndex} setScaleIndex={setScaleIndex} onResize={rememberPosition} />

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
            /* Offered whenever checking is switched on, not only once the
               dictionary has arrived. It is fetched when checking is first
               wanted — which, before any section is opened, is never — so
               gating on the speller hid the control exactly when it was the
               thing you wanted to press. */
            onNextMisspelling={
              spelling.enabled
                ? () => {
                    // A fresh pass: every section is worth offering again.
                    passTried.current.clear();
                    continueSpellingAfter(selectedId);
                  }
                : undefined
            }
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
  onResize,
}: {
  scaleIndex: number;
  setScaleIndex: (fn: (i: number) => number) => void;
  /** Called before the size changes, to note where the reader is. */
  onResize: () => void;
}) {
  return (
    <div className="text-size" role="group" aria-label="Text size">
      <button
        type="button"
        title="Smaller text"
        disabled={scaleIndex === 0}
        onClick={() => {
          onResize();
          setScaleIndex((i) => Math.max(0, i - 1));
        }}
      >
        A
      </button>
      <button
        type="button"
        title="Larger text"
        disabled={scaleIndex === SCALE_STEPS.length - 1}
        onClick={() => {
          onResize();
          setScaleIndex((i) => Math.min(SCALE_STEPS.length - 1, i + 1));
        }}
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
