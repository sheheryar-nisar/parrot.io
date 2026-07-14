(() => {
  function rectsIntersect(a, b) {
    return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
  }

  function isParrotElement(el, hostId) {
    if (!el) {
      return true;
    }
    if (el.id === hostId) {
      return true;
    }
    return Boolean(el.closest?.(`#${CSS.escape(hostId)}`));
  }

  function samplePoints(rect) {
    const cx = rect.x + rect.width / 2;
    const inset = Math.min(4, rect.height / 4);
    return [
      { x: cx, y: rect.y + rect.height / 2 },
      { x: cx, y: rect.y + inset },
      { x: cx, y: rect.y + rect.height - inset },
    ];
  }

  function findListsAtPoints(points, hostId) {
    const lists = new Set();

    for (const point of points) {
      const el = document.elementFromPoint(point.x, point.y);
      if (isParrotElement(el, hostId)) {
        continue;
      }

      const list = el?.closest?.('ul, ol');
      if (list && !isParrotElement(list, hostId)) {
        lists.add(list);
      }
    }

    return lists;
  }

  function extractFromList(list, selectionRect) {
    const lines = [];
    const items = list.querySelectorAll(':scope > li');
    const isOrdered = list.tagName === 'OL';

    items.forEach((li, index) => {
      const liRect = li.getBoundingClientRect();
      if (!rectsIntersect(liRect, selectionRect)) {
        return;
      }

      const text = li.innerText.trim();
      if (!text) {
        return;
      }

      const prefix = isOrdered ? `${index + 1}. ` : '- ';
      lines.push({
        top: liRect.top,
        left: liRect.left,
        text: prefix + text.replace(/\n/g, ' '),
      });
    });

    return lines;
  }

  function extractListTextInRect(rect, hostId) {
    if (!rect || typeof rect.x !== 'number' || typeof rect.y !== 'number') {
      return '';
    }

    const host = hostId ? document.getElementById(hostId) : null;
    const prevVisibility = host?.style.visibility ?? '';

    if (host) {
      host.style.visibility = 'hidden';
    }

    try {
      const selectionRect = {
        left: rect.x,
        top: rect.y,
        right: rect.x + rect.width,
        bottom: rect.y + rect.height,
      };

      const lists = findListsAtPoints(samplePoints(rect), hostId);
      const lines = [];

      for (const list of lists) {
        lines.push(...extractFromList(list, selectionRect));
      }

      lines.sort((a, b) => a.top - b.top || a.left - b.left);

      const seen = new Set();
      const unique = [];

      for (const line of lines) {
        if (seen.has(line.text)) {
          continue;
        }
        seen.add(line.text);
        unique.push(line.text);
      }

      return unique.join('\n');
    } finally {
      if (host) {
        host.style.visibility = prevVisibility;
      }
    }
  }

  function sampleGridPoints(rect) {
    const cols = Math.min(4, Math.max(1, Math.ceil(rect.width / 100)));
    const rows = Math.min(4, Math.max(1, Math.ceil(rect.height / 50)));
    const points = [];

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        points.push({
          x: rect.x + ((col + 0.5) * rect.width) / cols,
          y: rect.y + ((row + 0.5) * rect.height) / rows,
        });
      }
    }

    return points;
  }

  function extractVisibleTextInRect(rect, hostId) {
    if (!rect || typeof rect.x !== 'number' || typeof rect.y !== 'number') {
      return '';
    }

    const host = hostId ? document.getElementById(hostId) : null;
    const prevVisibility = host?.style.visibility ?? '';

    if (host) {
      host.style.visibility = 'hidden';
    }

    try {
      const selectionRect = {
        left: rect.x,
        top: rect.y,
        right: rect.x + rect.width,
        bottom: rect.y + rect.height,
      };

      const chunks = [];
      const seenElements = new Set();

      for (const point of sampleGridPoints(rect)) {
        const el = document.elementFromPoint(point.x, point.y);
        if (!el || isParrotElement(el, hostId)) {
          continue;
        }

        const block = el.closest?.(
          'p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, pre, label, a, span, div'
        );
        if (!block || isParrotElement(block, hostId) || seenElements.has(block)) {
          continue;
        }

        const blockRect = block.getBoundingClientRect();
        if (!rectsIntersect(blockRect, selectionRect)) {
          continue;
        }

        const text = block.innerText?.trim().replace(/\n{3,}/g, '\n\n');
        if (!text || text.length < 2) {
          continue;
        }

        seenElements.add(block);
        chunks.push({
          top: blockRect.top,
          left: blockRect.left,
          text,
        });
      }

      chunks.sort((a, b) => a.top - b.top || a.left - b.left);

      const unique = [];
      const seenText = new Set();

      for (const chunk of chunks) {
        if (seenText.has(chunk.text)) {
          continue;
        }
        seenText.add(chunk.text);
        unique.push(chunk.text);
      }

      return unique.join('\n');
    } finally {
      if (host) {
        host.style.visibility = prevVisibility;
      }
    }
  }

  window.__parrotExtractListTextInRect = extractListTextInRect;
  window.__parrotExtractVisibleTextInRect = extractVisibleTextInRect;
})();
