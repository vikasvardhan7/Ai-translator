export type Inline = { kind: 'text' | 'bold'; text: string } | { kind: 'link'; text: string; url: string };
export type Block = { kind: 'paragraph'; parts: Inline[] } | { kind: 'list'; ordered: boolean; items: Inline[][] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https:\/\/[^\s)]+)\)|(https:\/\/[^\s)]+)/g;

export function inline(text: string): Inline[] {
  const parts: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) {
      parts.push({ kind: 'text', text: text.slice(last, at) });
    }
    if (match[1] !== undefined) {
      parts.push({ kind: 'bold', text: match[1] });
    } else if (match[2] !== undefined && match[3] !== undefined) {
      parts.push({ kind: 'link', text: match[2], url: match[3] });
    } else if (match[4] !== undefined) {
      parts.push({ kind: 'link', text: match[4], url: match[4] });
    }
    last = at + match[0].length;
  }
  if (last < text.length) {
    parts.push({ kind: 'text', text: text.slice(last) });
  }
  return parts;
}

export function blocks(text: string): Block[] {
  const result: Block[] = [];
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length) {
      result.push({ kind: 'paragraph', parts: inline(paragraph.join('\n')) });
      paragraph = [];
    }
  };
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      flush();
      const ordered = numbered !== null;
      const previous = result.at(-1);
      if (previous?.kind === 'list' && previous.ordered === ordered) {
        previous.items.push(inline(item[1]));
      } else {
        result.push({ kind: 'list', ordered, items: [inline(item[1])] });
      }
    } else if (line.trim() === '') {
      flush();
    } else {
      paragraph.push(line.replace(/^#+\s+/, ''));
    }
  }
  flush();
  return result;
}
