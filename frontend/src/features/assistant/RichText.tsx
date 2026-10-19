import { Fragment } from 'react';

import { blocks, type Inline } from './markdown';

function Parts({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === 'bold') {
          return <strong key={index}>{part.text}</strong>;
        }
        if (part.kind === 'link') {
          return <a key={index} href={part.url} target="_blank" rel="noreferrer noopener">{part.text}</a>;
        }
        return <Fragment key={index}>{part.text}</Fragment>;
      })}
    </>
  );
}

export default function RichText({ text }: { text: string }) {
  return (
    <>
      {blocks(text).map((block, index) => {
        if (block.kind === 'paragraph') {
          return <p key={index} dir="auto"><Parts parts={block.parts} /></p>;
        }
        const List = block.ordered ? 'ol' : 'ul';
        return (
          <List key={index}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex} dir="auto"><Parts parts={item} /></li>
            ))}
          </List>
        );
      })}
    </>
  );
}
