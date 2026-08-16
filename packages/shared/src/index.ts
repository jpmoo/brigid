export * from "./variables.js";
export * from "./templates.js";
export * from "./works.js";
export * from "./words.js";
export * from "./numbering.js";
export * from "./outline.js";
export * from "./render.js";
export * from "./template-text.js";
export * from "./import.js";
export * from "./punctuation.js";
export * from "./prose.js";
export * from "./spelling.js";
export * from "./stats.js";
export * from "./digest.js";
// `sentences` is stats' own, re-exported by style for its own use; taking it
// from one place keeps the ambiguity out of the barrel.
export {
  measure,
  features,
  tokens,
  paragraphs,
  splitSpeech,
  syllables,
  featureLabel,
} from "./style.js";
export type { StyleFeatures, StyleMeasurement } from "./style.js";
export * from "./style-baseline.js";
export * from "./reference.js";
