import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getItem } from '../items/ItemRegistry.js';
import { leftClick, rightClick, maxStackOf } from '../player/slotOps.js';
import { matchRecipe } from '../crafting/CraftingEngine.js';
import { getSmeltTime } from '../crafting/Smelting.js';
import { itemIconURL } from '../textures/icons.js';
import { RecipeBook } from './RecipeBook.jsx';

const SLOT = 46; // px

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

function Slot({ stack, selected, onLeft, onRight, onEnter, onLeave }) {
  return (
    <div
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
        background: '#8b8b8b', position: 'relative', cursor: 'pointer',
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
function InventoryGrids({ inventory, onLeft, onRight, setHover }) {
  const main = [];
  for (let i = 9; i < 36; i++) main.push(i);
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(9, ${SLOT}px)`, gap: 2 }}>
        {main.map((i) => (
          <Slot key={i} stack={inventory.slots[i]}
            onLeft={() => onLeft(i)} onRight={() => onRight(i)}
            onEnter={setHover} onLeave={() => setHover(null)} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 2, marginTop: 12 }}>
        {inventory.slots.slice(0, 9).map((stack, i) => (
          <Slot key={i} stack={stack} selected={i === inventory.selected}
            onLeft={() => onLeft(i)} onRight={() => onRight(i)}
            onEnter={setHover} onLeave={() => setHover(null)} />
        ))}
      </div>
    </>
  );
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
  <div onMouseMove={onMouseMove} onContextMenu={(e) => e.preventDefault()} style={{
    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.55)', zIndex: 10,
  }}>
    <div style={{ background: '#c6c6c6', border: '4px solid #373737', borderRadius: 6, padding: 14, boxShadow: '0 8px 30px rgba(0,0,0,0.5)' }}>
      <div style={{ font: 'bold 16px system-ui', color: '#333', marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  </div>
);

const HINT = 'Left-click move/stack · Right-click split · Shift-click output to craft all · E / Esc to close';

// Always-visible read-only hotbar (slots 0-8).
export function Hotbar({ inventory }) {
  useInventoryVersion(inventory);
  return (
    <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 2, pointerEvents: 'none' }}>
      {inventory.slots.slice(0, 9).map((stack, i) => (
        <Slot key={i} stack={stack} selected={i === inventory.selected} />
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
  const gridRef = useRef(grid); gridRef.current = grid;

  useEffect(() => () => {
    const c = cursorRef.current;
    if (c) inventory.addItem(c.item, c.count);
    for (const s of gridRef.current) if (s) inventory.addItem(s.item, s.count);
  }, [inventory]);

  const result = useMemo(
    () => matchRecipe(grid.map((s) => (s ? s.item : null)), gridSize),
    [grid, gridSize]
  );

  const invLeft = (i) => setCursor(inventory.clickSlot(i, cursorRef.current));
  const invRight = (i) => setCursor(inventory.rightClickSlot(i, cursorRef.current));
  const cellLeft = (j) => { const r = leftClick(grid[j], cursorRef.current); const g = grid.slice(); g[j] = r.slot; setGrid(g); setCursor(r.cursor); };
  const cellRight = (j) => { const r = rightClick(grid[j], cursorRef.current); const g = grid.slice(); g[j] = r.slot; setGrid(g); setCursor(r.cursor); };
  const consumeOnce = (g) => g.map((s) => (s ? (s.count > 1 ? { ...s, count: s.count - 1 } : null) : null));

  const takeOutput = (shift) => {
    if (!result) return;
    if (shift) {
      let g = grid;
      let res = matchRecipe(g.map((s) => (s ? s.item : null)), gridSize);
      let guard = 0;
      while (res && inventory.canFit(res.item, res.count) && guard++ < 999) {
        inventory.addItem(res.item, res.count);
        g = consumeOnce(g);
        res = matchRecipe(g.map((s) => (s ? s.item : null)), gridSize);
      }
      setGrid(g);
      return;
    }
    const c = cursorRef.current;
    if (c && (c.item !== result.item || c.count + result.count > maxStackOf(result.item))) return;
    setCursor(c ? { item: c.item, count: c.count + result.count } : { ...result });
    setGrid(consumeOnce(grid));
  };

  return (
    <Panel title={title} onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridSize}, ${SLOT}px)`, gap: 2 }}>
          {grid.map((stack, j) => (
            <Slot key={j} stack={stack} onLeft={() => cellLeft(j)} onRight={() => cellRight(j)}
              onEnter={setHover} onLeave={() => setHover(null)} />
          ))}
        </div>
        <div style={{ font: '22px system-ui', color: '#555' }}>→</div>
        <div
          onMouseDown={(e) => { e.preventDefault(); if (e.button === 0) takeOutput(e.shiftKey); }}
          onMouseEnter={() => setHover(result ? result.item : null)}
          onMouseLeave={() => setHover(null)}
          style={{ width: SLOT, height: SLOT, border: '2px solid #555', background: '#8b8b8b', position: 'relative', cursor: result ? 'pointer' : 'default' }}
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

      <InventoryGrids inventory={inventory} onLeft={invLeft} onRight={invRight} setHover={setHover} />
      <div style={{ font: '12px system-ui', color: '#444', marginTop: 10, opacity: 0.8 }}>{HINT}</div>
      <CursorLayer cursor={cursor} mouse={mouse} hover={hover} />
      <RecipeBook inventory={inventory} />
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

  // Re-render periodically so the burn/cook bars animate.
  useEffect(() => { const id = setInterval(() => force((t) => t + 1), 80); return () => clearInterval(id); }, []);
  useEffect(() => () => { const c = cursorRef.current; if (c) inventory.addItem(c.item, c.count); }, [inventory]);

  const f = furnace;
  const invLeft = (i) => setCursor(inventory.clickSlot(i, cursorRef.current));
  const invRight = (i) => setCursor(inventory.rightClickSlot(i, cursorRef.current));
  const slotLeft = (name) => { const r = leftClick(f[name], cursorRef.current); f[name] = r.slot; setCursor(r.cursor); };
  const slotRight = (name) => { const r = rightClick(f[name], cursorRef.current); f[name] = r.slot; setCursor(r.cursor); };

  const takeOutput = () => {
    if (!f.output) return;
    const c = cursorRef.current;
    if (!c) { setCursor({ ...f.output }); f.output = null; return; }
    if (c.item === f.output.item) {
      const move = Math.min(maxStackOf(c.item) - c.count, f.output.count);
      if (move > 0) {
        setCursor({ item: c.item, count: c.count + move });
        f.output = f.output.count - move > 0 ? { item: f.output.item, count: f.output.count - move } : null;
      }
    }
  };

  const smeltTime = f.input ? getSmeltTime(f.input.item) : 0;
  const cookFrac = smeltTime ? Math.min(1, f.cook / smeltTime) : 0;
  const burnFrac = f.burnMax ? Math.max(0, Math.min(1, f.burnLeft / f.burnMax)) : 0;

  const SlotBox = ({ stack, onLeft, onRight }) => (
    <Slot stack={stack} onLeft={onLeft} onRight={onRight} onEnter={setHover} onLeave={() => setHover(null)} />
  );

  return (
    <Panel title="Furnace" onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
        {/* Input over fuel, with a flame gauge between */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <SlotBox stack={f.input} onLeft={() => slotLeft('input')} onRight={() => slotRight('input')} />
          <div style={{ width: 18, height: 18, background: '#555', borderRadius: 2, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${burnFrac * 100}%`, background: '#ff8c1a' }} />
          </div>
          <SlotBox stack={f.fuel} onLeft={() => slotLeft('fuel')} onRight={() => slotRight('fuel')} />
        </div>

        {/* Cook-progress arrow */}
        <div style={{ width: 80, height: 12, background: '#999', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${cookFrac * 100}%`, background: '#dadada' }} />
        </div>

        {/* Output (take-only) */}
        <div
          onMouseDown={(e) => { e.preventDefault(); if (e.button === 0 || e.button === 2) takeOutput(); }}
          onMouseEnter={() => setHover(f.output ? f.output.item : null)}
          onMouseLeave={() => setHover(null)}
          style={{ width: SLOT, height: SLOT, border: '2px solid #555', background: '#8b8b8b', position: 'relative', cursor: f.output ? 'pointer' : 'default' }}
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

      <InventoryGrids inventory={inventory} onLeft={invLeft} onRight={invRight} setHover={setHover} />
      <div style={{ font: '12px system-ui', color: '#444', marginTop: 10, opacity: 0.8 }}>
        Input on top, fuel below · output is take-only · E / Esc to close
      </div>
      <CursorLayer cursor={cursor} mouse={mouse} hover={hover} />
      <RecipeBook inventory={inventory} />
    </Panel>
  );
}

export function InventoryPanel({ inventory }) {
  return <CraftingScreen inventory={inventory} gridSize={2} title="Inventory" />;
}
export function CraftingTableScreen({ inventory }) {
  return <CraftingScreen inventory={inventory} gridSize={3} title="Crafting Table" />;
}
export { FurnaceScreen };
