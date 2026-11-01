import type { ClipboardEvent } from 'react';

/** Keep clipboard HTML and its block margins out of our text editors. */
export function pasteText(event: ClipboardEvent<HTMLElement>) {
  if (!event.clipboardData.types.includes('text/plain')) return;
  event.preventDefault();
  event.stopPropagation();
  const editor = event.currentTarget;
  const text = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
  // An empty rich editor contains <div><br></div>. Select that placeholder as
  // well, so inserting multiline text cannot leave an empty first block.
  if (!editor.textContent?.trim()) {
    const range = document.createRange();
    range.selectNodeContents(editor);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  document.execCommand('insertText', false, text);
}
