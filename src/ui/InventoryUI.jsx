import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getItem, ALL_ITEMS } from '../items/ItemRegistry.js';
import { leftClick, rightClick, maxStackOf } from '../player/slotOps.js';
import { matchRecipe } from '../crafting/CraftingEngine.js';
import { getSmeltTime } from '../crafting/Smelting.js';
import { itemIconURL } from '../textures/icons.js';
import { RecipeBook } from './RecipeBook.jsx';

const SLOT = 46; // px

// Take-only output slots (crafting result, furnace output): they have no
// "source" to return a swapped item to, so touch-drag swap-return skips them.
const TAKE_ONLY = new Set(['out', 'fout']);

// Textured item icon (pixelated). Falls back cleanly if no icon.
function ItemSprite({ name, inset = 5 }) {
  const url = itemIconURL(name);
  return (
    <div style={{
      position: 'absolute', inset,
      backgroundImage: url ? `url(${url})` : 'none',
      backgroundColor: url ? 'transparent' : itemColor(name),
      backgroundSize: '100% 100%', imageRendering: 'pixelated',
    }} />
  );
}

function useInventoryVersion(inventory) {
  const [, setV] = useState(0);
  useEffect(() => inventory.subscribe(() => setV((v) => v + 1)), [inventory]);
}

const itemColor = (name) => getItem(name)?.color || '#fff';
const itemDisplay = (name) => getItem(name)?.display || name;

function Slot({ stack, selected, onLeft, onRight, onEnter, onLeave, slotKey, pointer }) {
  return (
    <div
      data-slotkey={slotKey}
      {...(pointer || {})}
      onMouseDown={(e) => {
        e.preventDefault();
        if (e.button === 0) onLeft && onLeft(e.shiftKey);
        else if (e.button === 2) onRight && onRight();
      }}
      onMouseEnter={() => onEnter && onEnter(stack ? stack.item : null)}
      onMouseLeave={() => onLeave && onLeave()}
      style={{
        width: SLOT, height: SLOT, boxSizing: 'border-box',
        border: selected ? '2px solid #fff' : '2px solid #555',
        background: '#8b8b8b', position: 'relative', cursor: 'pointer', touchAction: 'none',
      }}
    >
      {stack && (
        <>
          <ItemSprite name={stack.item} />
          {stack.count > 1 && (
            <span style={{
              position: 'absolute', right: 3, bottom: 1, color: '#fff',
              font: 'bold 13px monospace', textShadow: '1px 1px 1px #000',
            }}>{stack.count}</span>
          )}
        </>
      )}
    </div>
  );
}

// The player's 27-slot main grid + 9-slot hotbar row, shared by every screen.
// `touch` (optional) provides bind(key) for touch/pen pointer interactions.
function InventoryGrids({ inventory, onLeft, onRight, setHover, touch }) {
  const main = [];
  for (let i = 9; i < 36; i++) main.push(i);
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(9, ${SLOT}px)`, gap: 2 }}>
        {main.map((i) => (
          <Slot key={i} stack={inventory.slots[i]} slotKey={`s${i}`}
            pointer={touch && touch.bind(`s${i}`)}
            onLeft={() => onLeft(i)} onRight={() => onRight(i)}
            onEnter={setHover} onLeave={() => setHover(null)} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 2, marginTop: 12 }}>
        {inventory.slots.slice(0, 9).map((stack, i) => (
          <Slot key={i} stack={stack} selected={i === inventory.selected} slotKey={`s${i}`}
            pointer={touch && touch.bind(`s${i}`)}
            onLeft={() => onLeft(i)} onRight={() => onRight(i)}
            onEnter={setHover} onLeave={() => setHover(null)} />
        ))}
      </div>
    </>
  );
}

// Touch/pen pointer handling for slots (mouse keeps the classic handlers):
//   • tap            = the slot's left-click action (pick up / place / swap)
//   • drag           = pick up at drag start, ghost follows the finger,
//                      release over another slot to drop there
//   • long-press     = the right-click action (split stack / take half)
// Pointer capture keeps move/up events flowing even when the finger leaves
// the slot; the drop target is found under the release point.
function useSlotPointer(leftByKey, rightByKey, setMouse, cursorRef) {
  const ref = useRef(null); // { key, x, y, dragging, done, timer }
  const clearTimer = () => {
    if (ref.current && ref.current.timer) {
      clearTimeout(ref.current.timer);
      ref.current.timer = null;
    }
  };

  const bind = (key) => ({
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse') return;
      e.preventDefault();
      e.stopPropagation();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* unsupported */ }
      setMouse({ x: e.clientX, y: e.clientY });
      const s = { key, x: e.clientX, y: e.clientY, dragging: false, done: false, timer: null };
      s.timer = setTimeout(() => {
        if (!s.dragging && !s.done) {
          s.done = true; // long-press consumed; the up does nothing more
          if (navigator.vibrate) navigator.vibrate(15);
          rightByKey(key);
        }
      }, 380);
      ref.current = s;
    },
    onPointerMove: (e) => {
      if (e.pointerType === 'mouse') return;
      const s = ref.current;
      if (!s) return;
      setMouse({ x: e.clientX, y: e.clientY });
      if (!s.dragging && !s.done && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) {
        s.dragging = true;
        clearTimer();
        leftByKey(s.key); // pick up (or place/swap) as the drag begins
      }
    },
    onPointerUp: (e) => {
      if (e.pointerType === 'mouse') return;
      const s = ref.current;
      if (!s) return;
      clearTimer();
      setMouse({ x: e.clientX, y: e.clientY });
      if (!s.done) {
        if (s.dragging) {
          const el = document.elementFromPoint(e.clientX, e.clientY);
          const holder = el && el.closest && el.closest('[data-slotkey]');
          const key = holder && holder.dataset.slotkey;
          if (key && key !== s.key) leftByKey(key); // drop/swap onto the release slot
          // Whatever is still on the cursor — the block displaced by a swap, or a
          // drag let go on the same slot / outside any slot — goes back into the
          // now-empty source slot, so a touch drag always ends clean instead of
          // leaving a block stuck to the cursor (the full-palette creative case).
          if (cursorRef && cursorRef.current && !TAKE_ONLY.has(s.key)) leftByKey(s.key);
        } else {
          leftByKey(s.key); // plain tap
        }
      }
      ref.current = null;
    },
    onPointerCancel: () => {
      clearTimer();
      ref.current = null;
    },
  });
  return { bind };
}

// Floating tooltip + the cursor-held stack that follows the mouse.
function CursorLayer({ cursor, mouse, hover }) {
  return (
    <>
      {hover && !cursor && (
        <div style={{
          position: 'fixed', left: mouse.x + 14, top: mouse.y + 10,
          background: '#1a1a2e', color: '#fff', padding: '4px 8px', borderRadius: 4,
          font: '13px system-ui', pointerEvents: 'none', border: '1px solid #4a4a6a',
        }}>{itemDisplay(hover)}</div>
      )}
      {cursor && (
        <div style={{ position: 'fixed', left: mouse.x - 18, top: mouse.y - 18, width: 36, height: 36, pointerEvents: 'none' }}>
          <ItemSprite name={cursor.item} inset={0} />
          {cursor.count > 1 && (
            <span style={{
              position: 'absolute', right: 0, bottom: -2, color: '#fff',
              font: 'bold 13px monospace', textShadow: '1px 1px 1px #000',
            }}>{cursor.count}</span>
          )}
        </div>
      )}
    </>
  );
}

const Panel = ({ title, children, onMouseMove }) => (
  <div onMouseMove={onMouseMove}
    onContextMenu={(e) => e.preventDefault()} style={{
    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.55)', zIndex: 10, touchAction: 'none',
  }}>
    <div style={{ background: '#c6c6c6', border: '4px solid #373737', borderRadius: 6, padding: 14, boxShadow: '0 8px 30px rgba(0,0,0,0.5)' }}>
      <div style={{ font: 'bold 16px system-ui', color: '#333', marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  </div>
);

const HINT = 'Left-click move/stack · Right-click split · Shift-click output to craft all · E / Esc to close';
const TOUCH_HINT = 'Touch: tap to move · drag to carry · hold to split';

// Always-visible hotbar (slots 0-8). `onSelect` makes slots tappable (touch).
export function Hotbar({ inventory, onSelect }) {
  useInventoryVersion(inventory);
  return (
    <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 2, zIndex: 8, pointerEvents: onSelect ? 'auto' : 'none' }}>
      {inventory.slots.slice(0, 9).map((stack, i) => (
        <div key={i}
          onTouchStart={onSelect ? (e) => { e.stopPropagation(); e.preventDefault(); onSelect(i); } : undefined}
          onMouseDown={onSelect ? () => onSelect(i) : undefined}>
          <Slot stack={stack} selected={i === inventory.selected} />
        </div>
      ))}
    </div>
  );
}

// Inventory + crafting screen (gridSize 2 = pocket, 3 = table).
function CraftingScreen({ inventory, gridSize, title }) {
  useInventoryVersion(inventory);
  const [cursor, setCursor] = useState(null);
  const [grid, setGrid] = useState(() => new Array(gridSize * gridSize).fill(null));
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState(null);

  const cursorRef = useRef(null); cursorRef.current = cursor;
  // Update the ref synchronously so two slot ops can run in one pointer event
  // (e.g. a touch swap: drop on target, then return the displaced block to source).
  const setCur = (c) => { cursorRef.current = c; setCursor(c); };
  const gridRef = useRef(grid); gridRef.current = grid;
  // Same synchronous-ref treatment for the grid: unlike inventory/furnace slots
  // (shared mutable objects), the grid is React state, so the second slot op of
  // a touch swap would otherwise read a stale grid and clobber the first op —
  // duplicating one stack and destroying the other.
  const setGridSync = (g) => { gridRef.current = g; setGrid(g); };

  useEffect(() => () => {
    const c = cursorRef.current;
    if (c) inventory.addItem(c.item, c.count);
    for (const s of gridRef.current) if (s) inventory.addItem(s.item, s.count);
  }, [inventory]);

  const result = useMemo(
    () => matchRecipe(grid.map((s) => (s ? s.item : null)), gridSize),
    [grid, gridSize]
  );

  const invLeft = (i) => setCur(inventory.clickSlot(i, cursorRef.current));
  const invRight = (i) => setCur(inventory.rightClickSlot(i, cursorRef.current));
  const cellLeft = (j) => { const g = gridRef.current.slice(); const r = leftClick(g[j], cursorRef.current); g[j] = r.slot; setGridSync(g); setCur(r.cursor); };
  const cellRight = (j) => { const g = gridRef.current.slice(); const r = rightClick(g[j], cursorRef.current); g[j] = r.slot; setGridSync(g); setCur(r.cursor); };
  const consumeOnce = (g) => g.map((s) => (s ? (s.count > 1 ? { ...s, count: s.count - 1 } : null) : null));

  const takeOutput = (shift) => {
    if (!result) return;
    if (shift) {
      let g = gridRef.current;
      let res = matchRecipe(g.map((s) => (s ? s.item : null)), gridSize);
      let guard = 0;
      while (res && inventory.canFit(res.item, res.count) && guard++ < 999) {
        inventory.addItem(res.item, res.count);
        g = consumeOnce(g);
        res = matchRecipe(g.map((s) => (s ? s.item : null)), gridSize);
      }
      setGridSync(g);
      return;
    }
    const c = cursorRef.current;
    if (c && (c.item !== result.item || c.count + result.count > maxStackOf(result.item))) return;
    setCur(c ? { item: c.item, count: c.count + result.count } : { ...result });
    setGridSync(consumeOnce(gridRef.current));
  };

  // Touch pointer routing by slot key.
  const leftByKey = (key) => {
    if (key === 'out') takeOutput(false);
    else if (key[0] === 'c') cellLeft(+key.slice(1));
    else invLeft(+key.slice(1)); // 's<index>'
  };
  const rightByKey = (key) => {
    if (key === 'out') takeOutput(false);
    else if (key[0] === 'c') cellRight(+key.slice(1));
    else invRight(+key.slice(1));
  };
  const drag = useSlotPointer(leftByKey, rightByKey, setMouse, cursorRef);

  return (
    <Panel title={title}
      onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridSize}, ${SLOT}px)`, gap: 2 }}>
          {grid.map((stack, j) => (
            <Slot key={j} stack={stack} slotKey={`c${j}`} pointer={drag.bind(`c${j}`)}
              onLeft={() => cellLeft(j)} onRight={() => cellRight(j)}
              onEnter={setHover} onLeave={() => setHover(null)} />
          ))}
        </div>
        <div style={{ font: '22px system-ui', color: '#555' }}>→</div>
        <div
          data-slotkey="out"
          {...drag.bind('out')}
          onMouseDown={(e) => { e.preventDefault(); if (e.button === 0) takeOutput(e.shiftKey); }}
          onMouseEnter={() => setHover(result ? result.item : null)}
          onMouseLeave={() => setHover(null)}
          style={{ width: SLOT, height: SLOT, border: '2px solid #555', background: '#8b8b8b', position: 'relative', cursor: result ? 'pointer' : 'default', touchAction: 'none' }}
        >
          {result && (
            <>
              <ItemSprite name={result.item} />
              {result.count > 1 && (
                <span style={{ position: 'absolute', right: 3, bottom: 1, color: '#fff', font: 'bold 13px monospace', textShadow: '1px 1px 1px #000' }}>{result.count}</span>
              )}
            </>
          )}
        </div>
      </div>

      <InventoryGrids inventory={inventory} onLeft={invLeft} onRight={invRight} setHover={setHover} touch={drag} />
      <div style={{ font: '12px system-ui', color: '#444', marginTop: 10, opacity: 0.8 }}>{HINT}<br />{TOUCH_HINT}</div>
      <CursorLayer cursor={cursor} mouse={mouse} hover={hover} />
      <RecipeBook inventory={inventory} maxCraftSize={gridSize} />
    </Panel>
  );
}

// Furnace screen: input + fuel -> output, with flame + cook-progress indicators.
function FurnaceScreen({ inventory, furnace }) {
  useInventoryVersion(inventory);
  const [cursor, setCursor] = useState(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState(null);
  const [, force] = useState(0);
  const cursorRef = useRef(null); cursorRef.current = cursor;
  // Update the ref synchronously so two slot ops can run in one pointer event
  // (e.g. a touch swap: drop on target, then return the displaced block to source).
  const setCur = (c) => { cursorRef.current = c; setCursor(c); };

  // Re-render periodically so the burn/cook bars animate.
  useEffect(() => { const id = setInterval(() => force((t) => t + 1), 80); return () => clearInterval(id); }, []);
  useEffect(() => () => { const c = cursorRef.current; if (c) inventory.addItem(c.item, c.count); }, [inventory]);

  const f = furnace;
  const invLeft = (i) => setCur(inventory.clickSlot(i, cursorRef.current));
  const invRight = (i) => setCur(inventory.rightClickSlot(i, cursorRef.current));
  const slotLeft = (name) => { const r = leftClick(f[name], cursorRef.current); f[name] = r.slot; setCur(r.cursor); };
  const slotRight = (name) => { const r = rightClick(f[name], cursorRef.current); f[name] = r.slot; setCur(r.cursor); };

  const takeOutput = () => {
    if (!f.output) return;
    const c = cursorRef.current;
    if (!c) { setCur({ ...f.output }); f.output = null; return; }
    if (c.item === f.output.item) {
      const move = Math.min(maxStackOf(c.item) - c.count, f.output.count);
      if (move > 0) {
        setCur({ item: c.item, count: c.count + move });
        f.output = f.output.count - move > 0 ? { item: f.output.item, count: f.output.count - move } : null;
      }
    }
  };

  const smeltTime = f.input ? getSmeltTime(f.input.item) : 0;
  const cookFrac = smeltTime ? Math.min(1, f.cook / smeltTime) : 0;
  const burnFrac = f.burnMax ? Math.max(0, Math.min(1, f.burnLeft / f.burnMax)) : 0;

  const leftByKey = (key) => {
    if (key === 'fin') slotLeft('input');
    else if (key === 'ffuel') slotLeft('fuel');
    else if (key === 'fout') takeOutput();
    else invLeft(+key.slice(1));
  };
  const rightByKey = (key) => {
    if (key === 'fin') slotRight('input');
    else if (key === 'ffuel') slotRight('fuel');
    else if (key === 'fout') takeOutput();
    else invRight(+key.slice(1));
  };
  const drag = useSlotPointer(leftByKey, rightByKey, setMouse, cursorRef);

  const SlotBox = ({ stack, onLeft, onRight, slotKey }) => (
    <Slot stack={stack} onLeft={onLeft} onRight={onRight} slotKey={slotKey}
      pointer={drag.bind(slotKey)} onEnter={setHover} onLeave={() => setHover(null)} />
  );

  return (
    <Panel title="Furnace"
      onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
        {/* Input over fuel, with a flame gauge between */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <SlotBox stack={f.input} slotKey="fin" onLeft={() => slotLeft('input')} onRight={() => slotRight('input')} />
          <div style={{ width: 18, height: 18, background: '#555', borderRadius: 2, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${burnFrac * 100}%`, background: '#ff8c1a' }} />
          </div>
          <SlotBox stack={f.fuel} slotKey="ffuel" onLeft={() => slotLeft('fuel')} onRight={() => slotRight('fuel')} />
        </div>

        {/* Cook-progress arrow */}
        <div style={{ width: 80, height: 12, background: '#999', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${cookFrac * 100}%`, background: '#dadada' }} />
        </div>

        {/* Output (take-only) */}
        <div
          data-slotkey="fout"
          {...drag.bind('fout')}
          onMouseDown={(e) => { e.preventDefault(); if (e.button === 0 || e.button === 2) takeOutput(); }}
          onMouseEnter={() => setHover(f.output ? f.output.item : null)}
          onMouseLeave={() => setHover(null)}
          style={{ width: SLOT, height: SLOT, border: '2px solid #555', background: '#8b8b8b', position: 'relative', cursor: f.output ? 'pointer' : 'default', touchAction: 'none' }}
        >
          {f.output && (
            <>
              <ItemSprite name={f.output.item} />
              {f.output.count > 1 && (
                <span style={{ position: 'absolute', right: 3, bottom: 1, color: '#fff', font: 'bold 13px monospace', textShadow: '1px 1px 1px #000' }}>{f.output.count}</span>
              )}
            </>
          )}
        </div>
      </div>

      <InventoryGrids inventory={inventory} onLeft={invLeft} onRight={invRight} setHover={setHover} touch={drag} />
      <div style={{ font: '12px system-ui', color: '#444', marginTop: 10, opacity: 0.8 }}>
        Input on top, fuel below · output is take-only · E / Esc to close<br />{TOUCH_HINT}
      </div>
      <CursorLayer cursor={cursor} mouse={mouse} hover={hover} />
      <RecipeBook inventory={inventory} maxCraftSize={0} />
    </Panel>
  );
}

// Chest screen: a routed get/set storage view (27 or 54 slots) + the player
// inventory below. `chest` is { size, title, get(i), set(i, stack) }.
export function ChestScreen({ chest, inventory }) {
  useInventoryVersion(inventory);
  const [, force] = useState(0);
  const [cursor, setCursor] = useState(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState(null);
  const cursorRef = useRef(null); cursorRef.current = cursor;
  // Update the ref synchronously so two slot ops can run in one pointer event
  // (e.g. a touch swap: drop on target, then return the displaced block to source).
  const setCur = (c) => { cursorRef.current = c; setCursor(c); };

  // Drop any cursor-held stack back into the inventory on close.
  useEffect(() => () => { const c = cursorRef.current; if (c) inventory.addItem(c.item, c.count); }, [inventory]);

  const chestLeft = (i) => { const r = leftClick(chest.get(i), cursorRef.current); chest.set(i, r.slot); setCur(r.cursor); force((v) => v + 1); };
  const chestRight = (i) => { const r = rightClick(chest.get(i), cursorRef.current); chest.set(i, r.slot); setCur(r.cursor); force((v) => v + 1); };
  const invLeft = (i) => setCur(inventory.clickSlot(i, cursorRef.current));
  const invRight = (i) => setCur(inventory.rightClickSlot(i, cursorRef.current));

  const leftByKey = (key) => { if (key[0] === 'g') chestLeft(+key.slice(1)); else invLeft(+key.slice(1)); };
  const rightByKey = (key) => { if (key[0] === 'g') chestRight(+key.slice(1)); else invRight(+key.slice(1)); };
  const drag = useSlotPointer(leftByKey, rightByKey, setMouse, cursorRef);

  const slots = [];
  for (let i = 0; i < chest.size; i++) slots.push(i);

  return (
    <Panel title={chest.title}
      onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(9, ${SLOT}px)`, gap: 2, marginBottom: 14 }}>
        {slots.map((i) => (
          <Slot key={i} stack={chest.get(i)} slotKey={`g${i}`} pointer={drag.bind(`g${i}`)}
            onLeft={() => chestLeft(i)} onRight={() => chestRight(i)}
            onEnter={setHover} onLeave={() => setHover(null)} />
        ))}
      </div>
      <InventoryGrids inventory={inventory} onLeft={invLeft} onRight={invRight} setHover={setHover} touch={drag} />
      <div style={{ font: '12px system-ui', color: '#444', marginTop: 10, opacity: 0.8 }}>
        Left-click move/stack · Right-click split · E / Esc to close<br />{TOUCH_HINT}
      </div>
      <CursorLayer cursor={cursor} mouse={mouse} hover={hover} />
    </Panel>
  );
}

// Creative palette: a scrollable grid of every block (then the rest of the
// items), each an infinite source. Tap/click one to grab a full stack onto the
// cursor, then drop it into your hotbar or inventory below. Placement never
// depletes in creative, so a single grab lasts forever. The palette scrolls on
// touch (it isn't a drag target), while the inventory grids keep full drag/swap.
const PALETTE = [
  ...ALL_ITEMS.filter((it) => it.placeBlock).map((it) => it.name),
  ...ALL_ITEMS.filter((it) => !it.placeBlock).map((it) => it.name),
];

function CreativeInventory({ inventory }) {
  useInventoryVersion(inventory);
  const [cursor, setCursor] = useState(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState(null);

  const cursorRef = useRef(null); cursorRef.current = cursor;
  const setCur = (c) => { cursorRef.current = c; setCursor(c); };

  // Drop any held stack back into the inventory on close.
  useEffect(() => () => { const c = cursorRef.current; if (c) inventory.addItem(c.item, c.count); }, [inventory]);

  // Grab a fresh full stack of a palette block onto the cursor (infinite).
  const grab = (name) => setCur({ item: name, count: maxStackOf(name) });

  const invLeft = (i) => setCur(inventory.clickSlot(i, cursorRef.current));
  const invRight = (i) => setCur(inventory.rightClickSlot(i, cursorRef.current));
  const drag = useSlotPointer((key) => invLeft(+key.slice(1)), (key) => invRight(+key.slice(1)), setMouse, cursorRef);

  return (
    <Panel title="Creative Inventory"
      onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}>
      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(9, ${SLOT}px)`, gap: 2,
        maxHeight: SLOT * 5 + 8, overflowY: 'auto', marginBottom: 14, touchAction: 'pan-y',
      }}>
        {PALETTE.map((name, i) => (
          <div key={i} onClick={() => grab(name)}
            onMouseEnter={() => setHover(name)} onMouseLeave={() => setHover(null)}
            style={{
              width: SLOT, height: SLOT, boxSizing: 'border-box', border: '2px solid #555',
              background: '#8b8b8b', position: 'relative', cursor: 'pointer',
            }}>
            <ItemSprite name={name} />
          </div>
        ))}
      </div>
      <InventoryGrids inventory={inventory} onLeft={invLeft} onRight={invRight} setHover={setHover} touch={drag} />
      <div style={{ font: '12px system-ui', color: '#444', marginTop: 10, opacity: 0.8 }}>
        Tap a block to grab it, then drop it into your hotbar · scroll the palette for more<br />{TOUCH_HINT}
      </div>
      <CursorLayer cursor={cursor} mouse={mouse} hover={hover} />
    </Panel>
  );
}

export function InventoryPanel({ inventory }) {
  return <CraftingScreen inventory={inventory} gridSize={2} title="Inventory" />;
}
export { CreativeInventory };
export function CraftingTableScreen({ inventory }) {
  return <CraftingScreen inventory={inventory} gridSize={3} title="Crafting Table" />;
}
export { FurnaceScreen };
