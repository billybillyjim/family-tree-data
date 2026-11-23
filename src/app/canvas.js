import { personName } from './graph.js';

export class GraphCanvas {
  constructor(canvas, onSelect, onContext = null) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSelect = onSelect;
    this.onContext = onContext;
    this.transform = d3.zoomIdentity;
    this.images = new Map();
    this.layout = null;
    this.data = null;
    this.highlights = null;
    this.selected = null;
    this.missingData = false;
    this.raf = 0;
    this.zoom = d3.zoom().scaleExtent([0.025, 3]).on('zoom', e => {
      this.onContext?.(null);
      this.transform = e.transform; this.drawSoon();
    });
    d3.select(canvas).call(this.zoom).on('dblclick.zoom', null);
    this.handleClick = e => {
      const id = this.hitTest(e.clientX, e.clientY);
      if (id) this.onSelect(id);
    };
    this.handleContext = e => {
      const id = this.hitTest(e.clientX, e.clientY);
      if (this.onContext?.(id, e)) e.preventDefault();
    };
    canvas.addEventListener('click', this.handleClick);
    canvas.addEventListener('contextmenu', this.handleContext);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }
  destroy() {
    this.resizeObserver.disconnect(); cancelAnimationFrame(this.raf); d3.select(this.canvas).on('.zoom', null);
    this.canvas.removeEventListener('click', this.handleClick);
    this.canvas.removeEventListener('contextmenu', this.handleContext);
  }
  hitTest(clientX, clientY) {
    if (!this.layout) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = this.transform.invertX(clientX - rect.left);
    const y = this.transform.invertY(clientY - rect.top);
    for (const n of this.layout.nodes.values()) {
      if (x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h) return n.id;
    }
    return null;
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width); this.height = Math.max(1, rect.height);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dpr = dpr;
    this.drawSoon();
  }
  setData(data, layout) {
    this.data = data;
    this.layout = layout;
    this.junctions = new Map();
    for (const { unionId, from } of layout.parentConnectors) {
      if (unionId) this.junctions.set(unionId, from);
    }
    this.images.clear();
    this.drawSoon();
  }
  setSelection(id, highlights, { missingData = false } = {}) {
    this.selected = id;
    this.highlights = highlights;
    this.missingData = missingData;
    this.drawSoon();
  }
  fit() {
    if (!this.layout?.count) { return; }
    const b = this.layout.bounds;
    const sx = Math.max(1, this.width - 80) / Math.max(1, b.maxX - b.minX);
    const sy = Math.max(1, this.height - 80) / Math.max(1, b.maxY - b.minY);
    const scale = Math.min(1.2, sx, sy);
    this.zoom.scaleExtent([Math.min(0.025, scale), 3]);
    const tx = (this.width - (b.maxX + b.minX) * scale) / 2;
    const ty = (this.height - (b.maxY + b.minY) * scale) / 2;
    d3.select(this.canvas).call(this.zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }
  focus(id) {
    const n = this.layout?.nodes.get(id);
    if (!n) { return; }
    const scale = Math.max(this.transform.k, 0.8);
    const x = this.width / 2 - (n.x + n.w / 2) * scale;
    const y = this.height / 2 - (n.y + n.h / 2) * scale;
    d3.select(this.canvas).transition().duration(350).call(this.zoom.transform, d3.zoomIdentity.translate(x, y).scale(scale));
  }
  zoomBy(factor) { d3.select(this.canvas).transition().duration(200).call(this.zoom.scaleBy, factor); }
  drawSoon() { if (!this.raf) { this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); }); } }
  image(path) {
    if (!path) { return null; }
    if (this.images.has(path)) { return this.images.get(path); }
    const image = new Image();
    this.images.set(path, image);
    image.onload = () => this.drawSoon();
    image.onerror = () => { this.images.set(path, null); };
    image.src = path;
    return image;
  }
  draw() {
    const ctx = this.ctx, w = this.width, h = this.height;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!this.layout || !this.data) { return; }
    const t = this.transform, k = t.k;
    const minX = -t.x / k - 250, minY = -t.y / k - 200;
    const maxX = (w - t.x) / k + 250, maxY = (h - t.y) / k + 200;
    const visible = n => n && n.x < maxX && n.x + n.w > minX && n.y < maxY && n.y + n.h > minY;
    function routeVisible(route) {
      for (let i = 1; i < route.length; i++) {
        const [ax, ay] = route[i - 1], [bx, by] = route[i];
        if (Math.max(ax, bx) >= minX && Math.min(ax, bx) <= maxX
          && Math.max(ay, by) >= minY && Math.min(ay, by) <= maxY) return true;
      }
      return false;
    }
    function trace(route) {
      ctx.moveTo(...route[0]);
      for (let i = 1; i < route.length; i++) ctx.lineTo(...route[i]);
    }
    ctx.translate(t.x, t.y); ctx.scale(k, k);
    const isLit = id => !this.highlights || this.highlights.has(id);
    const outline = Math.min(1.25 / k, 2 / Math.sqrt(k));
    const parentWidth = Math.max(1.25, 1.8 / Math.sqrt(k));
    const unionWidth = 2.5;
    function strokeConnector(color, width, alpha) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#101820';
      ctx.lineWidth = width + 2 * outline;
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    }

    // Lines only for edges near the viewport.
    const layers = [new Map(), new Map()];
    for (const connector of this.layout.parentConnectors) {
      const route = connector.route;
      if (!routeVisible(route)) continue;
      const lit = connector.parentIds.some(isLit) && isLit(connector.childId);
      const type = connector.types.length === 1 ? connector.types[0] : 'unknown';
      const key = JSON.stringify([connector.unionId, connector.unionId ? null : connector.parentIds[0], type]);
      const groups = layers[Number(lit)];
      if (!groups.has(key)) groups.set(key, { type, routes: [] });
      groups.get(key).routes.push(route);
    }
    for (const [layer, groups] of layers.entries()) {
      const lit = layer === 1;
      // Keep sibling drops and their shared stem together so their junctions stay connected.
      for (const { type, routes } of groups.values()) {
        const color = lit ? (type === 'step' ? '#d49b55' : type === 'adoptive' ? '#7b84db' : '#8e9cac') : '#526575';
        ctx.setLineDash(type === 'step' ? [7, 6] : type === 'adoptive' ? [3, 4] : []);
        ctx.beginPath();
        for (const route of routes) trace(route);
        strokeConnector(color, parentWidth, lit ? 0.8 : 0.2);
      }
      ctx.setLineDash([]);
      for (const u of this.layout.unions) {
        if (u.partnerIds.every(isLit) !== lit) continue;
        const route = this.layout.unionRoutes.get(u.id);
        if (!routeVisible(route)) continue;
        const color = u.type === 'marriage' ? '#bc6b84' : '#b18b60';
        ctx.beginPath();
        trace(route);
        strokeConnector(color, unionWidth, lit ? 0.85 : 0.2);
        const junction = this.junctions.get(u.id);
        if (junction) {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(...junction, Math.max(4, unionWidth / 2 + outline), 0, 2 * Math.PI);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
    // Avoid drawing huge text/photo DOMs at overview scale.
    for (const n of this.layout.nodes.values()) {
      if (!visible(n)) { continue; }
      const person = this.data.people[n.id];
      const lit = isLit(n.id), selected = n.id === this.selected;
      const missing = this.missingData && lit;
      ctx.globalAlpha = lit || selected ? 1 : 0.22;
      ctx.fillStyle = missing ? '#68502d' : selected ? '#23473d' : '#1d2c39';
      ctx.strokeStyle = selected ? '#7de0bb' : missing ? '#f4c777' : '#50677b';
      ctx.lineWidth = missing ? Math.max(3.5, 0.85 / k) : selected ? 3.5 : 1.4;
      ctx.beginPath(); ctx.roundRect(n.x, n.y, n.w, n.h, 11); ctx.fill(); ctx.stroke();
      if (k < 0.20) { continue; }
      ctx.fillStyle = '#edf4fa';
      const textX = k >= 0.38 ? n.x + 75 : n.x + 12;
      const available = n.w - (textX - n.x) - 10;
      const name = personName(person);
      ctx.font = '600 17px system-ui, sans-serif';
      const words = name.split(' '), lines = [];
      let line = '';
      for (const word of words) {
        const next = line ? line + ' ' + word : word;
        if (ctx.measureText(next).width > available && line) { lines.push(line); line = word; }
        else { line = next; }
      }
      if (line) { lines.push(line); }
      for (const [i, text] of lines.slice(0, 2).entries()) {
        let shown = text;
        while (shown.length > 3 && ctx.measureText(shown).width > available) { shown = shown.slice(0, -2) + '…'; }
        ctx.fillText(shown, textX, n.y + 27 + i * 18);
      }
      const detailY = n.y + (lines.length > 1 ? 66 : 51);
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillStyle = '#b9cad9';
      const born = person.birth?.date || '?', died = person.death?.date || '?';
      const dates = k >= 0.85 ? `B: ${born}  D: ${died}` : `${born.slice(0, 4)} – ${died.slice(0, 4)}`;
      ctx.fillText(dates, textX, detailY);
      if (k >= 0.65) {
        const birthplace = this.data.places[person.birth?.placeId]?.name || 'Unknown';
        const deathplace = this.data.places[person.death?.placeId]?.name || 'Unknown';
        ctx.font = '13px system-ui, sans-serif';
        ctx.fillStyle = '#a9bfce';
        const truncate = text => {
          while (text.length > 3 && ctx.measureText(text).width > available) { text = text.slice(0, -2) + '…'; }
          return text;
        };
        ctx.fillText(truncate('Born: ' + birthplace), textX, detailY + 22);
        ctx.fillText(truncate('Died: ' + deathplace), textX, detailY + 40);
        if (person.image) {
          const img = this.image(person.image);
          if (img?.complete && img.naturalWidth) {
            ctx.save(); ctx.beginPath(); ctx.roundRect(n.x + 10, n.y + 12, 55, 71, 6); ctx.clip();
            ctx.drawImage(img, n.x + 10, n.y + 12, 55, 71); ctx.restore();
          }
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}
