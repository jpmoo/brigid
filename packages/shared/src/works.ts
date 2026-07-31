import type { TemplateBody } from "./templates.js";

/**
 * Trim size and margins, in points (72pt = 1in). Only used to give the drafting
 * view the right measure and proportions — real pagination is an export concern.
 */
export interface PageSetup {
  widthPt: number;
  heightPt: number;
  marginTopPt: number;
  marginBottomPt: number;
  marginInnerPt: number;
  marginOuterPt: number;
}

/** US Trade 6x9, the most common trim for a novel. */
export const DEFAULT_PAGE_SETUP: PageSetup = {
  widthPt: 432,
  heightPt: 648,
  marginTopPt: 54,
  marginBottomPt: 54,
  marginInnerPt: 72,
  marginOuterPt: 54,
};

export interface RunningHead {
  /** Left-hand pages. Conventionally the author's name. */
  verso: TemplateBody;
  /** Right-hand pages. Conventionally the chapter or book title. */
  recto: TemplateBody;
}

export const EMPTY_BODY: TemplateBody = { nodes: [] };
