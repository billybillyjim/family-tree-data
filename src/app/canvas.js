import { personName } from './graph.js';
import { FORCE_LINK_STYLES, FORCE_NODE_RADIUS } from './force-layout.js';
import { surnameColorEntry } from './surname-colors.js';

const TIMELINE_AXIS_WIDTH = 64;
const AUTO_EASE_ALPHA = 0.12;
const DRAG_ALPHA = 0.18;

function timelineTicks(timeline, transform, height) {
  const { firstYear, lastYear, originY, yearSpacing, unknownY } = timeline;
  const { y, k } = transform;
  const ticks = [];
  function add(label, position) {
    const screenY = y + position * k;
    if (screenY >= 9 && screenY <= height - 9) ticks.push({ label, y: screenY });
  }
  if (firstYear !== null) {
    const spacing = k * yearSpacing;
    const minimum = Math.max(1, 48 / spacing);
    const power = 10 ** Math.floor(Math.log10(minimum));
    const step = [1, 2, 5, 10].find(n => n * power >= minimum) * power;
    const firstVisible = firstYear + (-y - originY * k) / spacing;
    const lastVisible = firstVisible + height / spacing;
    const start = Math.max(firstYear, firstVisible);
    const end = Math.min(lastYear, lastVisible);
    for (let year = Math.ceil(start / step) * step; year <= end; year += step) {
      add(String(year), originY + (year - firstYear) * yearSpacing);
    }
    if (!ticks.length && Math.ceil(start) <= end) {
      const year = Math.round((Math.ceil(start) + Math.floor(end)) / 2);
      add(String(year), originY + (year - firstYear) * yearSpacing);
    }
  }
  if (unknownY !== null) add('Unknown', unknownY);
  return ticks;
}

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
    this.colorBySurname = false;
    this.forceAutoEase = false;
    this.raf = 0;
    this.zoom = d3.zoom().scaleExtent([0.025, 3]).on('zoom', e => {
      this.onContext?.(null);
      this.transform = e.transform; this.drawSoon();
    });
    // Give node drags first chance at the gesture. Empty space still pans the canvas.
    d3.select(canvas).call(this.forceDrag()).call(this.zoom).on('dblclick.zoom', null);
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
    this.layout?.simulation?.stop().on('tick.canvas', null);
    this.layout = null;
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.raf);
    d3.select(this.canvas).interrupt().on('.zoom', null).on('.drag', null);
    this.canvas.removeEventListener('click', this.handleClick);
    this.canvas.removeEventListener('contextmenu', this.handleContext);
  }
  forceDrag() {
    return d3.drag().container(() => this.canvas).clickDistance(3)
      .subject(({ x, y }) => {
        const layout = this.layout;
        if (!layout?.simulation) return null;
        const rect = this.canvas.getBoundingClientRect();
        const id = this.hitTest(x + rect.left, y + rect.top);
        const particle = layout.nodes.get(id)?.particle;
        if (!particle || particle.fx != null) return null;
        return { layout, particle, x: this.transform.applyX(particle.x), y: this.transform.applyY(particle.y), moved: false };
      })
      .on('start', ({ subject: { particle } }) => {
        d3.select(this.canvas).interrupt();
        particle.fx = particle.x;
        particle.fy = particle.y;
      })
      .on('drag', ({ subject, x, y }) => {
        const { layout, particle } = subject;
        if (this.layout !== layout) return;
        if (!subject.moved) {
          subject.moved = true;
          this.onContext?.(null);
          if (layout.animate || this.forceAutoEase) {
            const simulation = layout.simulation;
            simulation.alpha(Math.max(simulation.alpha(), AUTO_EASE_ALPHA)).alphaTarget(DRAG_ALPHA).restart();
          }
        }
        particle.x = particle.fx = this.transform.invertX(x);
        particle.y = particle.fy = this.transform.invertY(y);
        particle.vx = particle.vy = 0;
        layout.updateGeometry();
        this.drawSoon();
      })
      .on('end', ({ active, subject: { layout, particle, moved } }) => {
        particle.fx = particle.fy = null;
        if (this.layout !== layout) return;
        if (!active) layout.simulation.alphaTarget(this.forceAutoEase ? AUTO_EASE_ALPHA : 0);
        if (moved && !layout.animate && !this.forceAutoEase) {
          layout.simulation.alpha(DRAG_ALPHA).tick(layout.settleTicks);
          layout.updateGeometry();
          this.drawSoon();
        }
      });
  }
  hitTest(clientX, clientY) {
    if (!this.layout) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (this.layout.timeline && clientX - rect.left < TIMELINE_AXIS_WIDTH) return null;
    const x = this.transform.invertX(clientX - rect.left);
    const y = this.transform.invertY(clientY - rect.top);
    const r = FORCE_NODE_RADIUS;
    for (const n of this.layout.nodes.values()) {
      if (this.layout.forceLinks) {
        if (Math.hypot(x - n.x - r, y - n.y - r) <= r) return n.id;
        continue;
      }
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
    this.layout?.simulation?.stop().on('tick.canvas', null);
    this.data = data;
    this.layout = layout;
    if (layout.simulation) {
      layout.simulation.on('tick.canvas', () => {
        layout.updateGeometry();
        this.drawSoon();
      });
      if (layout.animate && layout.count > 1) layout.simulation.restart();
      if (this.forceAutoEase) this.setForceAutoEase(true);
    }
    this.surnameColors = new Map(Object.entries(data.people).map(([id, person]) => [id, surnameColorEntry(person)?.color]));
    this.junctions = new Map();
    for (const { unionId, from } of layout.parentConnectors ?? []) {
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
  setColorBySurname(enabled) {
    this.colorBySurname = enabled;
    this.drawSoon();
  }
  setForceAutoEase(enabled) {
    this.forceAutoEase = enabled;
    const layout = this.layout;
    if (!layout?.simulation || !layout.count) return;
    const { simulation } = layout;
    layout.setAutoEase(enabled);
    if (simulation.alphaTarget() !== DRAG_ALPHA) {
      simulation.alphaTarget(enabled ? AUTO_EASE_ALPHA : 0);
    }
    if (enabled) simulation.restart();
  }
  fit() {
    if (!this.layout?.count) { return; }
    const b = this.layout.bounds;
    const inset = this.layout.timeline ? TIMELINE_AXIS_WIDTH : 0;
    const top = this.layout.timeline ? 90 : 40;
    const sx = Math.max(1, this.width - 80 - inset) / Math.max(1, b.maxX - b.minX);
    const sy = Math.max(1, this.height - 40 - top) / Math.max(1, b.maxY - b.minY);
    const scale = Math.min(1.2, sx, sy);
    this.zoom.scaleExtent([Math.min(0.025, scale), 3]);
    const tx = (this.width + inset - (b.maxX + b.minX) * scale) / 2;
    const ty = (this.height + top - 40 - (b.maxY + b.minY) * scale) / 2;
    d3.select(this.canvas).call(this.zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }
  focus(id) {
    const n = this.layout?.nodes.get(id);
    if (!n) { return; }
    const scale = Math.max(this.transform.k, 0.8);
    const inset = this.layout.timeline ? TIMELINE_AXIS_WIDTH : 0;
    const x = (this.width + inset) / 2 - (n.x + n.w / 2) * scale;
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
  drawForceGraph() {
    const { ctx, layout, transform: t } = this;
    const r = FORCE_NODE_RADIUS;
    const isLit = id => !this.highlights || this.highlights.has(id);
    const minX = t.invertX(0) - 140, maxX = t.invertX(this.width) + 140;
    const minY = t.invertY(0) - 60, maxY = t.invertY(this.height) + 60;
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);
    const edgeScale = Math.max(1, 0.45 / t.k);
    for (const { source, target, kind, bend } of layout.forceLinks) {
      const { x: ax, y: ay } = source;
      const { x: bx, y: by } = target;
      if (Math.max(ax, bx) < minX || Math.min(ax, bx) > maxX
        || Math.max(ay, by) < minY || Math.min(ay, by) > maxY) continue;
      const { color, width, dash } = FORCE_LINK_STYLES[kind];
      ctx.strokeStyle = color;
      ctx.globalAlpha = isLit(source.id) && isLit(target.id) ? 0.82 : 0.12;
      ctx.lineWidth = width * edgeScale;
      ctx.setLineDash(dash.map(length => length * edgeScale));
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      if (bend) {
        const length = Math.hypot(bx - ax, by - ay) || 1;
        ctx.quadraticCurveTo((ax + bx) / 2 - bend * (by - ay) / length,
          (ay + by) / 2 + bend * (bx - ax) / length, bx, by);
      } else {
        ctx.lineTo(bx, by);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.textAlign = 'center';
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.lineJoin = 'round';
    const labeled = [];
    for (const { id, x, y } of layout.nodes.values()) {
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      const selected = id === this.selected, lit = isLit(id);
      const missing = this.missingData && lit;
      ctx.globalAlpha = lit || selected ? 1 : 0.22;
      const surnameFill = this.colorBySurname ? this.surnameColors.get(id) : null;
      ctx.fillStyle = surnameFill || (missing ? '#68502d' : selected ? '#23473d' : '#368076');
      ctx.strokeStyle = selected ? '#7de0bb' : missing ? '#f4c777' : '#a0ceca';
      ctx.lineWidth = Math.max(selected || missing ? 3 : 1.5, 0.7 / t.k);
      ctx.beginPath();
      ctx.arc(x + r, y + r, r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      if (!selected && t.k >= 0.52) labeled.push(id);
    }
    if (layout.nodes.has(this.selected)) labeled.push(this.selected);
    for (const id of labeled) {
      const { x, y, h } = layout.nodes.get(id);
      const label = personName(this.data.people[id]);
      ctx.globalAlpha = isLit(id) || id === this.selected ? 1 : 0.22;
      ctx.strokeStyle = '#101820';
      ctx.lineWidth = 4;
      ctx.fillStyle = '#edf4fa';
      ctx.strokeText(label, x + r, y + h + 17, 160);
      ctx.fillText(label, x + r, y + h + 17, 160);
    }
    ctx.restore();
  }
  draw() {
    const ctx = this.ctx, w = this.width, h = this.height;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!this.layout || !this.data) { return; }
    if (this.layout.forceLinks) {
      this.drawForceGraph();
      return;
    }
    const t = this.transform, k = t.k;
    const yearTicks = this.layout.timeline && timelineTicks(this.layout.timeline, t, h);
    if (yearTicks) {
      ctx.strokeStyle = '#293a48';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      for (const { y } of yearTicks) {
        ctx.moveTo(TIMELINE_AXIS_WIDTH, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
    }
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
      const surnameFill = this.colorBySurname ? this.surnameColors.get(n.id) : null;
      ctx.fillStyle = surnameFill || (missing ? '#68502d' : selected ? '#23473d' : '#1d2c39');
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
    if (yearTicks) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = '#101820';
      ctx.fillRect(0, 0, TIMELINE_AXIS_WIDTH, h);
      ctx.strokeStyle = '#344655';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(TIMELINE_AXIS_WIDTH - 0.5, 0);
      ctx.lineTo(TIMELINE_AXIS_WIDTH - 0.5, h);
      ctx.stroke();
      ctx.fillStyle = '#bdcddb';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'right';
      for (const { label, y } of yearTicks) ctx.fillText(label, TIMELINE_AXIS_WIDTH - 6, y + 4);
      ctx.textAlign = 'start';
    }
  }
}
