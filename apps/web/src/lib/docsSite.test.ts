import { describe, expect, it } from 'vitest';
import { renderInline, renderMarkdown } from './docsSite';

describe('renderInline', () => {
  it('formats code, bold, italic and links, and escapes HTML', () => {
    expect(renderInline('**`http://x/`** and *it* <b>')).toBe('<strong><code>http://x/</code></strong> and <em>it</em> &lt;b&gt;');
  });

  it('points links between docs at the rendered pages', () => {
    expect(renderInline('[guide](INTEGRATION.md#rest) [ext](https://example.com)')).toBe(
      '<a href="integration.html#rest">guide</a> <a href="https://example.com">ext</a>',
    );
  });
});

describe('renderMarkdown', () => {
  it('renders headings with ids, tables with escaped pipes, lists and code blocks', () => {
    const r = renderMarkdown(
      [
        '# Title',
        '',
        '## Part A — iframe users',
        '',
        '| Param | Values |',
        '|---|---|',
        '| `theme` | `light\\|dark` |',
        '',
        '1. first line',
        '   continued',
        '2. second',
        '',
        '```html',
        '<iframe></iframe>',
        '```',
      ].join('\n'),
    );
    expect(r.title).toBe('Title');
    expect(r.headings).toEqual([{ level: 2, id: 'part-a-iframe-users', text: 'Part A — iframe users' }]);
    expect(r.html).toContain('<td><code>light|dark</code></td>');
    expect(r.html).toContain('<ol><li>first line continued</li><li>second</li></ol>');
    expect(r.html).toContain('<pre><code>&lt;iframe&gt;&lt;/iframe&gt;</code></pre>');
  });
});
