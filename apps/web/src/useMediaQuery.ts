import { useEffect, useState } from "react";

/**
 * A media query, as state.
 *
 * Layout is CSS's business, but a phone changes more than layout here: the
 * outline is a column you read beside the manuscript on a desktop and a sheet
 * you pull down over it on a phone, and "is it showing" means something
 * different in each. That is a decision the component has to make, so it has to
 * know the answer.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    // Read once on subscribe: the query may have changed between the first
    // render and this effect — rotating a phone is exactly that.
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);

  return matches;
}

/**
 * Wide enough for the outline to sit beside the manuscript, or not.
 *
 * Width rather than a pointer or user-agent test. A phone always matches it,
 * and a desktop window dragged this narrow has the same problem a phone does,
 * which is the problem being solved.
 */
export const PHONE = "(max-width: 700px)";
