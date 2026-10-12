/**
 * Build-time docs site: renders docs/*.md to standalone HTML pages served at /docs/ (no CDN, no runtime JS).
 * The renderer covers the Markdown the docs actually use: headings, paragraphs, lists, tables, fenced code,
 * blockquotes, rules, inline code, bold, italic and links.
 */

export interface DocEntry {
  file: string;
  slug: string;
  title: string;
  summary: string;
}

export const DOCS: DocEntry[] = [
  { file: 'TUTORIAL.md', slug: 'tutorial', title: 'Tutorial', summary: 'Show the map in an iframe without coding, or control it from JavaScript.' },
  { file: 'INTEGRATION.md', slug: 'integration', title: 'Integration guide', summary: 'Embed, SDK, REST API, WebSocket events, vector tiles and OGC API - Features.' },
  { file: 'RUNBOOK.md', slug: 'runbook', title: 'Operations runbook', summary: 'Build the map data, install, update, back up and verify the server.' },
  { file: 'GIS-CHECKLIST.md', slug: 'gis-checklist', title: 'GIS software checklist', summary: 'Manual acceptance steps for QGIS and ArcGIS Pro.' },
];

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

/** Links between docs (`INTEGRATION.md#x`) point at the rendered pages (`integration.html#x`). */
function docHref(href: string): string {
  const [path, hash] = href.split('#') as [string, string | undefined];
  const doc = DOCS.find((d) => d.file === path.replace(/^(\.\/|docs\/)/, ''));
  if (!doc) return href;
  return `${doc.slug}.html${hash ? `#${hash}` : ''}`;
}

export function renderInline(text: string): string {
  // Code spans first, so their contents are never treated as formatting.
  const codes: string[] = [];
  let s = text.replace(/`([^`]+)`/g, (_, code: string) => `\u0000${codes.push(code) - 1}\u0000`);
  s = escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?![\w*])/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => `<a href="${docHref(href)}">${label}</a>`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${escapeHtml(codes[Number(i)]!)}</code>`);
}

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));

const RE = {
  fence: /^```/,
  heading: /^(#{1,6})\s+(.*)$/,
  rule: /^-{3,}\s*$/,
  quote: /^>\s?/,
  ul: /^\s*[-*]\s+/,
  ol: /^\s*\d+\.\s+/,
  tableSep: /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/,
};

const startsBlock = (line: string, next: string | undefined) =>
  RE.fence.test(line) || RE.heading.test(line) || RE.rule.test(line) || RE.quote.test(line) || RE.ul.test(line) || RE.ol.test(line) || (line.startsWith('|') && !!next && RE.tableSep.test(next));

export interface RenderedDoc {
  title: string;
  html: string;
  headings: { level: number; id: string; text: string }[];
}

export function renderMarkdown(md: string): RenderedDoc {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  const headings: RenderedDoc['headings'] = [];
  let title = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
    } else if (RE.fence.test(line)) {
      const body: string[] = [];
      for (i++; i < lines.length && !RE.fence.test(lines[i]!); i++) body.push(lines[i]!);
      i++;
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
    } else if (RE.heading.test(line)) {
      const [, hashes, text] = RE.heading.exec(line)!;
      const level = hashes!.length;
      const html = renderInline(text!);
      const id = slugify(html);
      if (level === 1 && !title) title = html.replace(/<[^>]+>/g, '');
      if (level > 1) headings.push({ level, id, text: html.replace(/<[^>]+>/g, '') });
      out.push(`<h${level} id="${id}">${html}</h${level}>`);
      i++;
    } else if (RE.rule.test(line)) {
      out.push('<hr />');
      i++;
    } else if (line.startsWith('|') && RE.tableSep.test(lines[i + 1] ?? '')) {
      const head = splitRow(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i]!.trim().startsWith('|'); i++) rows.push(splitRow(lines[i]!));
      const cells = (r: string[], tag: string) => r.map((c) => `<${tag}>${renderInline(c)}</${tag}>`).join('');
      out.push(`<div class="table"><table><thead><tr>${cells(head, 'th')}</tr></thead><tbody>${rows.map((r) => `<tr>${cells(r, 'td')}</tr>`).join('')}</tbody></table></div>`);
    } else if (RE.quote.test(line)) {
      const body: string[] = [];
      for (; i < lines.length && RE.quote.test(lines[i]!); i++) body.push(lines[i]!.replace(RE.quote, ''));
      out.push(`<blockquote><p>${renderInline(body.join(' '))}</p></blockquote>`);
    } else if (RE.ul.test(line) || RE.ol.test(line)) {
      const ordered = RE.ol.test(line);
      const marker = ordered ? RE.ol : RE.ul;
      const items: string[] = [];
      for (; i < lines.length && lines[i]!.trim(); i++) {
        const l = lines[i]!;
        if (marker.test(l)) items.push(l.replace(marker, ''));
        else if (startsBlock(l, lines[i + 1])) break;
        else items[items.length - 1] += ` ${l.trim()}`;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((it) => `<li>${renderInline(it)}</li>`).join('')}</${tag}>`);
    } else {
      const body: string[] = [];
      for (; i < lines.length && lines[i]!.trim() && !(body.length && startsBlock(lines[i]!, lines[i + 1])); i++) body.push(lines[i]!.trim());
      out.push(`<p>${renderInline(body.join(' '))}</p>`);
    }
  }
  return { title, html: out.join('\n'), headings };
}

/** Shared look for the landing page and docs pages (light and dark). */
export const SITE_CSS = `
:root {
  --accent: #007aff; --label: #1d1d1f; --label-2: #6e6e73; --bg: #f5f5f7; --card: #ffffff; --separator: rgba(60, 60, 67, 0.16);
  --fill: rgba(118, 118, 128, 0.12); --code: #f2f2f7;
  color-scheme: light dark;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter Variable', system-ui, 'Segoe UI', sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root { --accent: #0a84ff; --label: #f5f5f7; --label-2: #a1a1a6; --bg: #000000; --card: #1c1c1e; --separator: rgba(84, 84, 88, 0.6); --fill: rgba(118, 118, 128, 0.24); --code: #2c2c2e; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--label); font-size: 15px; line-height: 1.6; -webkit-font-smoothing: antialiased; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.topbar { position: sticky; top: 0; z-index: 10; background: color-mix(in srgb, var(--bg) 80%, transparent); backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%); border-bottom: 0.5px solid var(--separator); }
.topbar div { max-width: 1080px; margin: 0 auto; padding: 10px 16px; display: flex; align-items: center; gap: 18px; overflow-x: auto; white-space: nowrap; font-size: 14px; }
.topbar .brand { font-weight: 700; color: var(--label); margin-right: auto; }
.topbar a { color: var(--label-2); }
.topbar a:hover, .topbar a[aria-current] { color: var(--accent); text-decoration: none; }
.btn { display: inline-block; border-radius: 999px; padding: 9px 18px; font-weight: 600; font-size: 15px; background: var(--accent); color: #fff; }
.btn:hover { text-decoration: none; filter: brightness(1.08); }
.btn.secondary { background: var(--fill); color: var(--accent); }
.topbar .btn { padding: 6px 14px; font-size: 13px; color: #fff; }
main { max-width: 1080px; margin: 0 auto; padding: 8px 16px 80px; }
code { font: 13px ui-monospace, 'SF Mono', Menlo, Consolas, monospace; background: var(--code); padding: 1px 5px; border-radius: 5px; overflow-wrap: anywhere; }
pre { background: var(--code); border-radius: 14px; padding: 16px 18px; overflow: auto; font: 13px/1.55 ui-monospace, 'SF Mono', Menlo, Consolas, monospace; }
pre code { background: none; padding: 0; overflow-wrap: normal; }
.table { overflow-x: auto; background: var(--card); border-radius: 14px; padding: 4px 8px; margin: 12px 0; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 9px 12px; border-bottom: 0.5px solid var(--separator); vertical-align: top; }
th { color: var(--label-2); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.3px; }
tr:last-child td { border-bottom: 0; }
blockquote { margin: 12px 0; border-left: 3px solid var(--accent); padding: 2px 0 2px 14px; color: var(--label-2); }
hr { border: 0; border-top: 0.5px solid var(--separator); margin: 36px 0; }
`;

export function topbar(current: 'home' | 'docs' | string): string {
  const link = (href: string, label: string, key: string) => `<a href="${href}"${current === key ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<nav class="topbar"><div>
  <a class="brand" href="/">AI Map</a>
  ${link('/docs/tutorial.html', 'Tutorial', 'tutorial')}
  ${link('/docs/', 'Documentation', 'docs')}
  ${link('/api/v1/docs/', 'API reference', 'api')}
  ${link('/sdk/examples/', 'Examples', 'examples')}
  <a class="btn" href="/map">Open map</a>
</div></nav>`;
}

const page = (title: string, current: string, extraCss: string, body: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="icon" href="data:," />
  <style>${SITE_CSS}${extraCss}</style>
</head>
<body>
${topbar(current)}
${body}
</body>
</html>
`;

const DOC_CSS = `
.doc { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 32px; }
.toc { position: sticky; top: 60px; align-self: start; max-height: calc(100vh - 80px); overflow: auto; padding-top: 32px; font-size: 13px; }
.toc a { display: block; color: var(--label-2); padding: 3px 0; }
.toc a.l3 { padding-left: 12px; }
.toc a:hover { color: var(--accent); text-decoration: none; }
article { min-width: 0; }
article h1 { font-size: 36px; letter-spacing: -0.6px; margin: 32px 0 12px; line-height: 1.2; }
article h2 { font-size: 26px; letter-spacing: -0.4px; margin: 40px 0 8px; scroll-margin-top: 60px; }
article h3 { font-size: 19px; margin: 28px 0 8px; scroll-margin-top: 60px; }
article h4 { font-size: 16px; margin: 22px 0 6px; scroll-margin-top: 60px; }
@media (max-width: 860px) { .doc { grid-template-columns: 1fr; } .toc { display: none; } }
.index { list-style: none; padding: 0; display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
.index li a { display: block; background: var(--card); border-radius: 18px; padding: 20px; height: 100%; color: var(--label); }
.index li a:hover { text-decoration: none; box-shadow: 0 0 0 2px var(--accent); }
.index strong { display: block; font-size: 17px; margin-bottom: 4px; }
.index span { color: var(--label-2); font-size: 14px; }
`;

export function docPage(doc: DocEntry, md: string): string {
  const r = renderMarkdown(md);
  const toc = r.headings
    .filter((h) => h.level <= 3)
    .map((h) => `<a class="l${h.level}" href="#${h.id}">${escapeHtml(h.text)}</a>`)
    .join('\n');
  return page(`${r.title || doc.title} · AI Map`, doc.slug, DOC_CSS, `<main class="doc"><nav class="toc" aria-label="On this page">${toc}</nav><article>${r.html}</article></main>`);
}

const LANDING_CSS = `
.hero { padding: 72px 0 40px; }
.hero h1 { font-size: 48px; letter-spacing: -1px; margin: 0 0 10px; line-height: 1.1; }
.hero p { color: var(--label-2); font-size: 19px; margin: 0 0 24px; max-width: 720px; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; }
section { margin-top: 56px; scroll-margin-top: 60px; }
h2 { font-size: 28px; letter-spacing: -0.4px; margin: 0 0 6px; }
.lead { color: var(--label-2); margin: 0 0 18px; }
.grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.card { display: block; background: var(--card); border-radius: 18px; padding: 20px; color: var(--label); }
a.card:hover { text-decoration: none; box-shadow: 0 0 0 2px var(--accent); }
.card h3 { margin: 0 0 4px; font-size: 17px; }
.card p { margin: 0; color: var(--label-2); font-size: 14px; }
.card .tag { display: inline-block; margin-top: 10px; font-size: 12px; font-weight: 600; color: var(--accent); }
.steps { counter-reset: step; list-style: none; padding: 0; display: grid; gap: 12px; }
.steps li { min-width: 0; counter-increment: step; background: var(--card); border-radius: 18px; padding: 18px 20px 18px 64px; position: relative; }
.steps li::before { content: counter(step); position: absolute; left: 20px; top: 18px; width: 28px; height: 28px; border-radius: 50%; background: var(--accent); color: #fff; font-weight: 700; display: grid; place-items: center; font-size: 14px; }
.steps h3 { margin: 0 0 4px; font-size: 16px; }
.steps p { margin: 0 0 6px; color: var(--label-2); font-size: 14px; }
@media (max-width: 600px) { .hero { padding-top: 40px; } .hero h1 { font-size: 36px; } }
`;

/** Start page at "/": what the server offers, the tutorial path and the documentation. The map itself is at /map. */
export function landingPage(): string {
  const docs = DOCS.map((d) => `<a class="card" href="/docs/${d.slug}.html"><h3>${d.title}</h3><p>${d.summary}</p></a>`).join('\n');
  return page(
    'AI Map',
    'home',
    LANDING_CSS,
    `<main>
  <header class="hero">
    <h1>AI Map</h1>
    <p>An offline vector map for this network: search, measurement, terrain and shared drawings. Nothing on this server needs internet access.</p>
    <div class="actions">
      <a class="btn" href="/map">Open the map</a>
      <a class="btn secondary" href="/docs/tutorial.html">Read the tutorial</a>
      <a class="btn secondary" href="/docs/">Documentation</a>
    </div>
  </header>

  <section id="tutorial">
    <h2>Tutorial</h2>
    <p class="lead">Use the map in your own application. Start with the simplest step that meets your needs.</p>
    <ol class="steps">
      <li>
        <h3>Embed the map with an iframe (no coding)</h3>
        <p>Paste one tag into any page on the network, then choose the position, theme and visible tools with URL parameters.</p>
        <pre><code>&lt;iframe src="<span class="origin"></span>/embed?center=46.67,24.71&amp;zoom=10" style="width:100%; height:600px; border:0" title="Map"&gt;&lt;/iframe&gt;</code></pre>
        <p><a href="/docs/tutorial.html#part-a-iframe-users">Part A of the tutorial</a> · <a href="/sdk/examples/tutorial.html#builder">Iframe URL builder</a></p>
      </li>
      <li>
        <h3>Control the map from JavaScript</h3>
        <p>Load the SDK from this server to add vehicle markers, focus on locations, save shared objects and listen to clicks.</p>
        <p><a href="/docs/tutorial.html#part-b-javascript-developers">Part B of the tutorial</a> · <a href="/sdk/examples/tutorial.html#playground">Live playground</a></p>
      </li>
      <li>
        <h3>Use the REST API, vector tiles or GIS software</h3>
        <p>Backends in any language, QGIS and ArcGIS Pro read and write the same data.</p>
        <p><a href="/docs/integration.html">Integration guide</a> · <a href="/api/v1/docs/">API reference</a> · <a href="/docs/gis-checklist.html">GIS checklist</a></p>
      </li>
    </ol>
  </section>

  <section id="docs">
    <h2>Documentation</h2>
    <p class="lead">Everything is also available offline in the <code>docs/</code> folder of the release.</p>
    <div class="grid">
${docs}
      <a class="card" href="/sdk/examples/tutorial.html"><h3>Interactive tutorial</h3><p>Iframe URL builder and a live SDK playground.</p></a>
      <a class="card" href="/api/v1/docs/"><h3>REST API reference</h3><p>Every endpoint, with a try-it-out console (Swagger UI) and openapi.json.</p></a>
      <a class="card" href="/sdk/examples/"><h3>SDK examples</h3><p>Embedded map, your own MapLibre map, SDK downloads.</p></a>
    </div>
  </section>

  <section id="map">
    <h2>The map</h2>
    <p class="lead">The full map application has its own address. Share it, bookmark it, or open it in a new tab.</p>
    <div class="grid">
      <a class="card" href="/map"><h3><span class="origin"></span>/map</h3><p>Search, measure, terrain and shared drawing layers.</p><span class="tag">Open the map →</span></a>
      <a class="card" href="/embed"><h3><span class="origin"></span>/embed</h3><p>The same map for iframes in other applications.</p><span class="tag">Open the embed view →</span></a>
    </div>
  </section>
</main>
<script>for (const el of document.querySelectorAll('.origin')) el.textContent = location.origin;</script>`,
  );
}

export function docsIndexPage(): string {
  const items = DOCS.map((d) => `<li><a href="${d.slug}.html"><strong>${d.title}</strong><span>${d.summary}</span></a></li>`).join('\n');
  const extra = `<li><a href="/sdk/examples/tutorial.html"><strong>Interactive tutorial</strong><span>Iframe URL builder and a live SDK playground.</span></a></li>
<li><a href="/api/v1/docs/"><strong>REST API reference</strong><span>Every endpoint, with a try-it-out console (Swagger UI) and openapi.json.</span></a></li>
<li><a href="/sdk/examples/"><strong>SDK examples</strong><span>Embedded map, your own MapLibre map, SDK downloads.</span></a></li>`;
  return page(
    'Documentation · AI Map',
    'docs',
    `${DOC_CSS} main h1 { font-size: 36px; letter-spacing: -0.6px; margin: 32px 0 20px; }`,
    `<main><h1>Documentation</h1><ul class="index">${items}\n${extra}</ul></main>`,
  );
}
