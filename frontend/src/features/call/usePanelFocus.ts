import { useEffect, useRef, type RefObject } from 'react';

const openPanels: Array<{ current: () => void }> = [];

function closeTopPanel(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    openPanels.at(-1)?.current();
  }
}

export function usePanelFocus(open: boolean, onClose: () => void, panel: RefObject<HTMLElement | null>): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    openPanels.push(closeRef);
    if (openPanels.length === 1) {
      document.addEventListener('keydown', closeTopPanel);
    }
    return () => {
      openPanels.splice(openPanels.indexOf(closeRef), 1);
      if (openPanels.length === 0) {
        document.removeEventListener('keydown', closeTopPanel);
      }
      opener?.focus();
    };
  }, [open, panel]);
}
