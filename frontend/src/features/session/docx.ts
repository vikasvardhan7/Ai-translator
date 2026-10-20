import type { TranscriptEntry } from './transcript';
import { zipStored } from './zip';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const RELATIONSHIPS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const RIGHT_TO_LEFT = /^[^\p{L}]*[֐-ࣿיִ-﷿ﹰ-ﻼ]/u;
const NOT_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;

const PACKAGE_LINKS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${RELATIONSHIPS}"><Relationship Id="rId1" Type="${OFFICE}/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOCUMENT_LINKS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${RELATIONSHIPS}"><Relationship Id="rId1" Type="${OFFICE}/styles" Target="styles.xml"/></Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${WORD}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei" w:cs="Nirmala UI"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/><w:color w:val="14659F"/></w:rPr></w:style></w:styles>`;

function escape(text: string): string {
  return text
    .replace(NOT_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  grey?: boolean;
}

function run({ text, bold, italic, grey }: Run, rightToLeft: boolean): string {
  const style = [bold ? '<w:b/><w:bCs/>' : '', italic ? '<w:i/><w:iCs/>' : '', grey ? '<w:color w:val="5B6B7A"/>' : '', rightToLeft ? '<w:rtl/>' : ''].join('');
  return `<w:r>${style ? `<w:rPr>${style}</w:rPr>` : ''}<w:t xml:space="preserve">${escape(text)}</w:t></w:r>`;
}

function paragraph(runs: Run[], options: { style?: string; space?: number; indent?: boolean } = {}): string {
  const rightToLeft = RIGHT_TO_LEFT.test(runs.map((item) => item.text).join(''));
  const settings = [
    options.style ? `<w:pStyle w:val="${options.style}"/>` : '',
    rightToLeft ? '<w:bidi/>' : '',
    options.space !== undefined ? `<w:spacing w:before="${options.space}"/>` : '',
    options.indent ? '<w:ind w:left="360"/>' : '',
  ].join('');
  return `<w:p>${settings ? `<w:pPr>${settings}</w:pPr>` : ''}${runs.map((item) => run(item, rightToLeft)).join('')}</w:p>`;
}

export function transcriptDocument(title: string, subtitle: string, entries: readonly TranscriptEntry[]): string {
  const body = [
    paragraph([{ text: title }], { style: 'Title' }),
    paragraph([{ text: subtitle, grey: true }]),
    ...entries.flatMap((entry) => [
      paragraph([{ text: entry.speaker, bold: true }, { text: `  ${entry.time} · ${entry.languageName}`, grey: true }], { space: 200 }),
      paragraph([{ text: entry.text }]),
      ...entry.heard.map((line) => paragraph([{ text: `${line.who} (${line.languageName}): `, grey: true }, { text: line.text, italic: true }], { indent: true })),
    ]),
  ].join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${WORD}" xmlns:r="${OFFICE}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

export function transcriptDocx(title: string, subtitle: string, entries: readonly TranscriptEntry[], at: Date = new Date()): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  return zipStored([
    { name: '[Content_Types].xml', data: encoder.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: encoder.encode(PACKAGE_LINKS) },
    { name: 'word/_rels/document.xml.rels', data: encoder.encode(DOCUMENT_LINKS) },
    { name: 'word/styles.xml', data: encoder.encode(STYLES) },
    { name: 'word/document.xml', data: encoder.encode(transcriptDocument(title, subtitle, entries)) },
  ], at);
}
