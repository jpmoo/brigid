/**
 * Measuring published novels, so "usual" can stop being a guess.
 *
 * The graph used to place a manuscript against four ranges I had written down
 * from general style guidance. They were roughly right and entirely unbacked,
 * and there was no way for a writer to check them. This replaces them with
 * arithmetic over actual books.
 *
 * Only public-domain texts, from Project Gutenberg, and only the numbers are
 * kept — no prose is stored or shipped. A mean sentence length is a fact about
 * a book, not a piece of it.
 *
 * Run by hand, not at build time: it fetches tens of megabytes and the answer
 * does not change. `pnpm tsx tools/harvest-reference.ts`
 */
import { readFileSync, writeFileSync } from "node:fs";
import { measure } from "@brigid/shared";

interface Candidate {
  author: string;
  title: string;
  year: number;
  /** Loose, and only to spread the sample — not a claim about the book. */
  kind: string;
  /**
   * Whether what would be measured is a translator's English rather than the
   * author's. Kept, because the prose is still prose and still various, but
   * flagged: nothing about Homer's sentences survives into a count of Butler's.
   */
  translated?: boolean;
}

const CANDIDATES: Candidate[] = [
  // Spare and modern — the end of the range the older books do not reach.
  { author: "Ernest Hemingway", title: "The Sun Also Rises", year: 1926, kind: "Literary" },
  { author: "Ernest Hemingway", title: "A Farewell to Arms", year: 1929, kind: "Literary" },
  { author: "Ernest Hemingway", title: "In Our Time", year: 1925, kind: "Short stories" },
  { author: "Dashiell Hammett", title: "Red Harvest", year: 1929, kind: "Hardboiled" },
  { author: "Dashiell Hammett", title: "The Maltese Falcon", year: 1930, kind: "Hardboiled" },
  { author: "Virginia Woolf", title: "Mrs Dalloway", year: 1925, kind: "Modernist" },
  { author: "Virginia Woolf", title: "To the Lighthouse", year: 1927, kind: "Modernist" },
  { author: "William Faulkner", title: "The Sound and the Fury", year: 1929, kind: "Modernist" },
  { author: "Agatha Christie", title: "The Murder of Roger Ackroyd", year: 1926, kind: "Detective" },
  { author: "E. M. Forster", title: "A Passage to India", year: 1924, kind: "Literary" },
  { author: "Sinclair Lewis", title: "Babbitt", year: 1922, kind: "Satire" },
  { author: "John Dos Passos", title: "Manhattan Transfer", year: 1925, kind: "Modernist" },
  { author: "Willa Cather", title: "Death Comes for the Archbishop", year: 1927, kind: "Literary" },
  { author: "Willa Cather", title: "My Antonia", year: 1918, kind: "Literary" },
  { author: "P. G. Wodehouse", title: "Carry On, Jeeves", year: 1925, kind: "Comic" },
  { author: "Sherwood Anderson", title: "Winesburg, Ohio", year: 1919, kind: "Short stories" },
  { author: "F. Scott Fitzgerald", title: "This Side of Paradise", year: 1920, kind: "Literary" },
  { author: "Erich Maria Remarque", title: "All Quiet on the Western Front", year: 1929, kind: "War", translated: true },
  { author: "Yevgeny Zamyatin", title: "We", year: 1924, kind: "Science fiction", translated: true },

  // Genre, so the set is not all literary fiction.
  { author: "Zane Grey", title: "Riders of the Purple Sage", year: 1912, kind: "Western" },
  { author: "John Buchan", title: "The Thirty-Nine Steps", year: 1915, kind: "Thriller" },
  { author: "Wilkie Collins", title: "The Moonstone", year: 1868, kind: "Detective" },
  { author: "H. Rider Haggard", title: "King Solomon's Mines", year: 1885, kind: "Adventure" },
  { author: "Baroness Orczy", title: "The Scarlet Pimpernel", year: 1905, kind: "Adventure" },
  { author: "Arthur Conan Doyle", title: "The Lost World", year: 1912, kind: "Science fiction" },
  { author: "G. K. Chesterton", title: "The Man Who Was Thursday", year: 1908, kind: "Thriller" },
  { author: "Jack London", title: "The Call of the Wild", year: 1903, kind: "Adventure" },
  { author: "Jack London", title: "White Fang", year: 1906, kind: "Adventure" },
  { author: "Edgar Allan Poe", title: "The Works of Edgar Allan Poe, Volume 1", year: 1849, kind: "Horror" },
  { author: "Jules Verne", title: "Twenty Thousand Leagues under the Sea", year: 1870, kind: "Science fiction", translated: true },
  { author: "H. G. Wells", title: "The Invisible Man", year: 1897, kind: "Science fiction" },
  { author: "H. G. Wells", title: "The Time Machine", year: 1895, kind: "Science fiction" },
  { author: "Joseph Conrad", title: "Heart of Darkness", year: 1899, kind: "Adventure" },
  { author: "Joseph Conrad", title: "Lord Jim", year: 1900, kind: "Literary" },

  // Children's and comic, which sit at the plain end.
  { author: "Kenneth Grahame", title: "The Wind in the Willows", year: 1908, kind: "Children's" },
  { author: "Frances Hodgson Burnett", title: "The Secret Garden", year: 1911, kind: "Children's" },
  { author: "Lucy Maud Montgomery", title: "Anne of Green Gables", year: 1908, kind: "Children's" },
  { author: "J. M. Barrie", title: "Peter Pan", year: 1911, kind: "Children's" },
  { author: "Lewis Carroll", title: "Alice's Adventures in Wonderland", year: 1865, kind: "Children's" },
  { author: "L. Frank Baum", title: "The Wonderful Wizard of Oz", year: 1900, kind: "Children's" },
  { author: "Mark Twain", title: "The Adventures of Tom Sawyer", year: 1876, kind: "Children's" },

  // The nineteenth century, at length.
  { author: "Jane Austen", title: "Pride and Prejudice", year: 1813, kind: "Comedy of manners" },
  { author: "Jane Austen", title: "Emma", year: 1815, kind: "Comedy of manners" },
  { author: "Herman Melville", title: "Moby-Dick", year: 1851, kind: "Adventure" },
  { author: "Charles Dickens", title: "Great Expectations", year: 1861, kind: "Social realism" },
  { author: "Charles Dickens", title: "A Tale of Two Cities", year: 1859, kind: "Historical" },
  { author: "Charlotte Bronte", title: "Jane Eyre", year: 1847, kind: "Romance" },
  { author: "Emily Bronte", title: "Wuthering Heights", year: 1847, kind: "Romance" },
  { author: "George Eliot", title: "Middlemarch", year: 1871, kind: "Social realism" },
  { author: "Thomas Hardy", title: "Tess of the d'Urbervilles", year: 1891, kind: "Social realism" },
  { author: "Henry James", title: "The Portrait of a Lady", year: 1881, kind: "Literary" },
  { author: "Nathaniel Hawthorne", title: "The Scarlet Letter", year: 1850, kind: "Historical" },
  { author: "Stephen Crane", title: "The Red Badge of Courage", year: 1895, kind: "War" },
  { author: "Mark Twain", title: "Adventures of Huckleberry Finn", year: 1884, kind: "Vernacular" },
  { author: "Elizabeth Gaskell", title: "North and South", year: 1855, kind: "Social realism" },
  { author: "Anthony Trollope", title: "Barchester Towers", year: 1857, kind: "Comedy of manners" },
  { author: "Rudyard Kipling", title: "Kim", year: 1901, kind: "Adventure" },
  { author: "Edith Wharton", title: "The Age of Innocence", year: 1920, kind: "Literary" },
  { author: "Edith Wharton", title: "Ethan Frome", year: 1911, kind: "Literary" },
  { author: "Kate Chopin", title: "The Awakening", year: 1899, kind: "Literary" },
  { author: "Upton Sinclair", title: "The Jungle", year: 1906, kind: "Social realism" },

  // Gothic and horror.
  { author: "Bram Stoker", title: "Dracula", year: 1897, kind: "Gothic" },
  { author: "Mary Shelley", title: "Frankenstein", year: 1818, kind: "Gothic" },
  { author: "Oscar Wilde", title: "The Picture of Dorian Gray", year: 1890, kind: "Gothic" },
  { author: "Robert Louis Stevenson", title: "Strange Case of Dr Jekyll and Mr Hyde", year: 1886, kind: "Gothic" },
  { author: "Robert Louis Stevenson", title: "Treasure Island", year: 1883, kind: "Adventure" },
  { author: "Sheridan Le Fanu", title: "Carmilla", year: 1872, kind: "Gothic" },

  // Detective, which is where the plainest sentences of the period are.
  { author: "Arthur Conan Doyle", title: "The Adventures of Sherlock Holmes", year: 1892, kind: "Detective" },
  { author: "Arthur Conan Doyle", title: "The Hound of the Baskervilles", year: 1902, kind: "Detective" },
  { author: "Agatha Christie", title: "The Mysterious Affair at Styles", year: 1920, kind: "Detective" },

  // Modernist, and translated work, both flagged for what they are.
  { author: "James Joyce", title: "Ulysses", year: 1922, kind: "Modernist" },
  { author: "James Joyce", title: "A Portrait of the Artist as a Young Man", year: 1916, kind: "Modernist" },
  { author: "James Joyce", title: "Dubliners", year: 1914, kind: "Short stories" },
  { author: "Franz Kafka", title: "Metamorphosis", year: 1915, kind: "Modernist", translated: true },
  { author: "Fyodor Dostoyevsky", title: "Crime and Punishment", year: 1866, kind: "Literary", translated: true },
  { author: "Leo Tolstoy", title: "Anna Karenina", year: 1878, kind: "Literary", translated: true },
  { author: "Gustave Flaubert", title: "Madame Bovary", year: 1856, kind: "Literary", translated: true },
  { author: "Alexandre Dumas", title: "The Three Musketeers", year: 1844, kind: "Adventure", translated: true },
  { author: "Homer", title: "The Iliad", year: -750, kind: "Epic", translated: true },
];

/**
 * The catalog, rather than an id typed from memory.
 *
 * Guessed ids were how Moby-Dick nearly got measured as another book. The
 * search is asked for the title and the author, and the answer is checked
 * against both before anything is downloaded.
 */
async function resolve(book: Candidate): Promise<string[]> {
  type Entry = {
    id: number;
    title: string;
    authors: { name: string }[];
    formats: Record<string, string>;
  };

  /**
   * Title and author first, title alone if that finds nothing.
   *
   * The catalog's own search does not fold accents: "bronte" matches no book
   * it holds, so asking for "Jane Eyre Bronte" returns zero results and asking
   * for "Jane Eyre" returns it twice. The author is checked here instead, where
   * the accents can be stripped from both sides.
   */
  const ask = async (query: string): Promise<Entry[]> => {
    const res = await fetch(`https://gutendex.com/books/?search=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return [];
    return ((await res.json()) as { results: Entry[] }).results ?? [];
  };

  const surnameFirst = await ask(`${book.title} ${book.author.split(" ").at(-1)}`);
  const found = {
    results: surnameFirst.length > 0 ? surnameFirst : await ask(book.title),
  };

  const surname = plain(book.author.split(" ").at(-1)!);
  const wanted = plain(book.title).split(" ").filter((w) => w.length > 3);

  const urls: string[] = [];
  for (const entry of found.results ?? []) {
    const title = plain(entry.title);
    const authors = entry.authors.map((a) => plain(a.name)).join(" ");
    if (!authors.includes(surname)) continue;
    if (wanted.length > 0 && !wanted.every((w) => title.includes(w))) continue;

    for (const [type, href] of Object.entries(entry.formats)) {
      if (!type.startsWith("text/plain")) continue;
      // A readme is not a book, and the catalog offers one as the plain text of
      // some entries. It passed every check that followed, because a readme
      // names the title and the author it is about — which is exactly what was
      // being checked. Four hundred words of Winesburg, Ohio.
      if (/readme|\.zip$/i.test(href)) continue;
      urls.push(href);
    }
  }
  // Every candidate, not the first: the word floor below is a better test of
  // whether a file is the book than anything that can be asked of the catalog,
  // so it is allowed to reject one and move on.
  return urls;
}

/** Lowercased and stripped of accents, so "Brontë" and "Bronte" are one name. */
function plain(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
}

/** The features kept. Enough to compare on, few enough to ship in a bundle. */
const KEEP = [
  "sent.mean", "sent.sd", "sent.short", "sent.long",
  "punct.comma", "punct.semicolon", "punct.dash", "punct.exclaim", "punct.question",
  "para.words", "para.single",
  "lex.ttr", "lex.syllables", "lex.latinate", "lex.monosyll",
  "open.conjunction", "open.participle", "open.the",
  "pov.first", "pov.third", "pov.filtering", "pov.past",
  "mod.adverb", "mod.intensifier", "mod.hedge", "mod.negation",
  "tag.rate", "tag.said", "tag.adverb",
  "rhythm.syllPerSent",
];

/**
 * The book without its wrapper, and without its front and back matter.
 *
 * Gutenberg's boilerplate is marked, so that much is exact. The rest is a
 * judgment: the opening of a novel carries a title page, a dedication and a
 * table of contents, and the end carries appendices — none of which is prose
 * and all of which would drag the numbers. Taking the middle avoids the
 * question entirely.
 */
function body(raw: string): string {
  const start = raw.search(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG/i);
  const end = raw.search(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG/i);
  let text = raw.slice(
    start >= 0 ? raw.indexOf("\n", start) + 1 : 0,
    end >= 0 ? end : raw.length,
  );

  // Underscores are Gutenberg's italics and would be counted as word
  // characters; the rest is transcription furniture.
  text = text.replace(/_/g, "").replace(/\[Illustration[^\]]*\]/gi, "");

  /**
   * How much of the middle to take.
   *
   * A long novel can spare the first fifth and still leave plenty; a novella
   * cannot, and taking a fixed fraction of one threw away books worth having —
   * Heart of Darkness and Metamorphosis both fell under the floor for no reason
   * except that they are short. So the trim shrinks with the book.
   */
  const generous = text.length < 400_000;
  const from = Math.floor(text.length * (generous ? 0.08 : 0.2));
  const to = Math.floor(text.length * (generous ? 0.96 : 0.7));
  return text.slice(from, to);
}

const out: Record<string, unknown>[] = [];
const missed: string[] = [];

for (const book of CANDIDATES) {
  try {
    const urls = await resolve(book);
    if (urls.length === 0) {
      missed.push(`${book.title} — not in the catalog under that title and author`);
      continue;
    }

    let measured: ReturnType<typeof measure> | null = null;
    let why = "";

    for (const url of urls.slice(0, 4)) {
      const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      if (!res.ok) {
        why = `HTTP ${res.status}`;
        continue;
      }
      const raw = await res.text();

      // Checked against the file itself, not only the catalog entry that led
      // here. Punctuation becomes a space rather than nothing: "Moby-Dick"
      // squeezed to "mobydick" matches no header ever written.
      const head = plain(raw.slice(0, 3000));
      const surname = plain(book.author.split(" ").at(-1)!);
      const words = plain(book.title).split(" ").filter((w) => w.length > 3);
      if (!head.includes(surname) || (words.length > 0 && !words.some((w) => head.includes(w)))) {
        why = "the file is a different book";
        continue;
      }

      const m = measure(body(raw));
      // Enough for the function-word rates to settle, and the surest sign that
      // what was downloaded is a novel rather than a file about one.
      if (m.words < 9000) {
        why = `only ${m.words} words in it`;
        continue;
      }
      measured = m;
      break;
    }

    if (!measured) {
      missed.push(`${book.title} — ${why || "nothing usable"}`);
      continue;
    }

    const features: Record<string, number> = {};
    for (const key of KEEP) {
      const value = measured.overall[key];
      if (value !== undefined) features[key] = Math.round(value * 1e4) / 1e4;
    }

    out.push({
      author: book.author,
      title: book.title,
      year: book.year,
      kind: book.kind,
      ...(book.translated ? { translated: true } : {}),
      words: measured.words,
      dialogueShare: Math.round(measured.dialogueShare * 1e4) / 1e4,
      features,
    });
    console.log(`  ok   ${book.author} — ${book.title} (${measured.words.toLocaleString()} words)`);
  } catch (err) {
    missed.push(`${book.title} — ${(err as Error).message}`);
  }
}

console.log(`\n${out.length} measured, ${missed.length} skipped`);
for (const m of missed) console.log(`  --   ${m}`);

// Emitted as TypeScript rather than JSON so it needs no loader, no build step
// and no `resolveJsonModule`: it is a constant, and a constant is code.
const header = readFileSync(new URL("./reference-header.txt", import.meta.url), "utf8");
writeFileSync(
  new URL("../packages/shared/src/reference-data.ts", import.meta.url),
  `${header}${JSON.stringify(out, null, 2)};\n`,
);
