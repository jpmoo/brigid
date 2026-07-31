import type { TemplateBody, Typography, WorkMeta } from "@brigid/shared";
import { BodyEditor } from "./BodyEditor.js";
import { PagePreview } from "./PagePreview.js";
import { StyleMenu } from "./StyleMenu.js";

/**
 * The editing surface for a format, wherever it is being edited.
 *
 * Settings edits the shared format; a block edits its own detached copy. Both
 * go through here so the two can't drift into looking like different things —
 * the only difference is whose body is being changed.
 */
export function FormatFields({
  styleOnly,
  body,
  onBody,
  typography,
  onTypography,
  work,
}: {
  /** A format whose body is only the content slot has type but no arrangement. */
  styleOnly: boolean;
  body: TemplateBody;
  onBody: (next: TemplateBody) => void;
  typography: Typography;
  onTypography: (next: Typography) => void;
  work: WorkMeta;
}) {
  if (styleOnly) {
    return (
      <>
        <h4 className="tpl-section">Style</h4>
        <StyleMenu value={typography} onChange={onTypography} />
      </>
    );
  }

  return (
    <>
      <h4 className="tpl-section">Layout</h4>
      <div className="with-preview">
        <div className="wp-editor">
          <BodyEditor body={body} onChange={onBody} />
        </div>
        {/* Where things sit down the page is most of what a title page or a
            chapter opening is, and no list of rows shows that. */}
        <PagePreview body={body} work={work} />
      </div>
    </>
  );
}
