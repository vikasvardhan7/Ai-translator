(function () {
  var script = document.currentScript;
  if (!script || window.__voiceTranslatorWidget) {
    return;
  }
  window.__voiceTranslatorWidget = true;

  var key = script.getAttribute('data-key') || '';
  var label = script.getAttribute('data-label') || 'Translate';
  var side = script.getAttribute('data-position') === 'left' ? 'left' : 'right';
  var color = script.getAttribute('data-color') || '#14659f';
  var base = new URL(script.src, window.location.href).origin;
  var frame = null;
  var open = false;

  var style = document.createElement('style');
  style.textContent = [
    '.vtw-button{position:fixed;bottom:20px;' + side + ':20px;z-index:2147483000;display:inline-flex;align-items:center;gap:8px;',
    'padding:12px 18px;border:0;border-radius:999px;color:#fff;background:' + color + ';font:600 15px/1.2 system-ui,sans-serif;',
    'box-shadow:0 10px 28px rgba(0,0,0,.25);cursor:pointer;transition:transform .2s ease}',
    '.vtw-button:hover{transform:translateY(-2px)}',
    '.vtw-button:focus-visible{outline:3px solid #7cc4f0;outline-offset:3px}',
    '.vtw-button svg{width:20px;height:20px;fill:currentColor}',
    '.vtw-panel{position:fixed;bottom:80px;' + side + ':20px;z-index:2147483000;width:min(440px,calc(100vw - 24px));',
    'height:min(680px,calc(100vh - 110px));border:0;border-radius:18px;background:#fff;box-shadow:0 18px 48px rgba(0,0,0,.3);',
    'display:none}',
    '.vtw-panel[data-open="true"]{display:block}',
    '@media (max-width:520px){.vtw-panel{' + side + ':12px;bottom:76px;width:calc(100vw - 24px);height:calc(100vh - 96px)}}',
    '@media (prefers-reduced-motion:reduce){.vtw-button{transition:none}}'
  ].join('');
  document.head.appendChild(style);

  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'vtw-button';
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm14 4h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1v3l-4-3h-4a2 2 0 0 1-2-2v-1h5a3 3 0 0 0 3-3z"/></svg>';
  var text = document.createElement('span');
  text.textContent = label;
  button.appendChild(text);

  function show(next) {
    open = next;
    if (open && !frame) {
      frame = document.createElement('iframe');
      frame.className = 'vtw-panel';
      frame.title = 'Voice Translator';
      frame.allow = 'microphone; display-capture; autoplay; clipboard-write';
      frame.src = base + '/#embed/' + encodeURIComponent(key);
      document.body.appendChild(frame);
    }
    if (frame && !open) {
      frame.remove();
      frame = null;
    }
    if (frame) {
      frame.setAttribute('data-open', 'true');
    }
    button.setAttribute('aria-expanded', String(open));
    text.textContent = open ? 'Close' : label;
  }

  button.addEventListener('click', function () {
    show(!open);
  });
  document.addEventListener('keydown', function (event) {
    if (open && event.key === 'Escape') {
      show(false);
      button.focus();
    }
  });

  function place() {
    document.body.appendChild(button);
  }
  if (document.body) {
    place();
  } else {
    document.addEventListener('DOMContentLoaded', place);
  }
})();
