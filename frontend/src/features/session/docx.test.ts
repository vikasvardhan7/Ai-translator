import { describe, expect, it } from 'vitest';

import { transcriptDocument, transcriptDocx } from './docx';
import { transcriptPage } from './printout';
import type { TranscriptEntry } from './transcript';

const entries: TranscriptEntry[] = [
  {
    time: '07:30:10',
    speaker: 'Person 2',
    languageName: 'Telugu',
    text: 'మీరు ఎలా ఉన్నారు?',
    heard: [{ who: 'Person 1', languageName: 'English', text: 'How are you? <fine> & well' }],
  },
  { time: '07:30:15', speaker: 'Speaker 1', languageName: 'Arabic', text: 'مرحبا\u0007', heard: [] },
];

describe('Word transcript', () => {
  it('is a Word package with the document, its styles and their links', () => {
    const bytes = transcriptDocx('Budget meeting', '20 October 2026', entries);
    const stored = new TextDecoder().decode(bytes);

    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
    for (const name of ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/styles.xml', 'word/document.xml']) {
      expect(stored).toContain(name);
    }
    expect(stored).toContain(transcriptDocument('Budget meeting', '20 October 2026', entries));
  });

  it('keeps every script, escapes markup and writes right-to-left text right to left', () => {
    const document = transcriptDocument('Budget & plans', 'today', entries);

    expect(document).toContain('<w:t xml:space="preserve">Budget &amp; plans</w:t>');
    expect(document).toContain('మీరు ఎలా ఉన్నారు?');
    expect(document).toContain('How are you? &lt;fine&gt; &amp; well');
    expect(document).toContain('<w:bidi/>');
    expect(document).toContain('<w:rtl/>');
    expect(document).not.toContain('\u0007');
  });
});

describe('printable transcript', () => {
  it('lays out each sentence and lets the browser handle every script', () => {
    const page = transcriptPage('Budget <meeting>', 'today', entries);

    expect(page).toContain('<title>Budget &lt;meeting&gt;</title>');
    expect(page).toContain('<p dir="auto">మీరు ఎలా ఉన్నారు?</p>');
    expect(page).toContain('<em>How are you? &lt;fine&gt; &amp; well</em>');
    expect(page).toContain('@page');
  });
});
