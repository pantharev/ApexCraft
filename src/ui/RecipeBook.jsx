import React, { useEffect, useMemo, useState } from 'react';
import { getItem } from '../items/ItemRegistry.js';
import { itemIconURL } from '../textures/icons.js';
import { RECIPES } from '../crafting/CraftingEngine.js';
import { SMELTING } from '../crafting/Smelting.js';

function useInv(inv) {
  const [, set] = useState(0);
  useEffect(() => inv.subscribe(() => set((v) => v + 1)), [inv]);
}

const display = (name) => getItem(name)?.display || name;

function Icon({ name, size = 36, dim = false, onClick, onEnter, onLeave }) {
  const url = itemIconURL(name);
  return (
    <div
      onClick={onClick}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        width: size, height: size, boxSizing: 'border-box',
        border: '2px solid #555', background: '#2a2d33',
        cursor: onClick ? 'pointer' : 'default', opacity: dim ? 0.35 : 1, position: 'relative',
      }}
    >
      <div style={{
        position: 'absolute', inset: 3, backgroundImage: url ? `url(${url})` : 'none',
        backgroundColor: url ? 'transparent' : '#888', backgroundSize: '100% 100%', imageRendering: 'pixelated',
      }} />
    </div>
  );
}

const tabBtn = {
  position: 'fixed', left: 16, top: 16, zIndex: 15, font: '14px system-ui',
  padding: '8px 14px', cursor: 'pointer', background: '#3c6b3c', color: '#fff',
  border: '2px solid #244524', borderRadius: 4,
};

// Recipe book: browse all recipes, see ingredients, and one-click craft anything
// you have the materials for. Shown inside the inventory/table/furnace screens.
export function RecipeBook({ inventory }) {
  useInv(inventory);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState(null); // recipe or smelting entry

  const f = filter.trim().toLowerCase();
  const matches = (name) => !f || display(name).toLowerCase().includes(f);

  const crafts = useMemo(() => RECIPES, []);
  const visibleCrafts = crafts.filter((r) => matches(r.result.item));
  const visibleSmelts = SMELTING.filter((r) => matches(r.output));

  if (!open) return <button style={tabBtn} onClick={() => setOpen(true)}>Recipes</button>;

  const craft = (r, all) => {
    do { if (!inventory.craftRecipe(r.requirements, r.result)) break; } while (all);
  };

  return (
    <div
      onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}
      style={{
        position: 'fixed', left: 16, top: 16, bottom: 16, width: 300, zIndex: 15,
        background: '#1b1d22', border: '3px solid #3a3d44', borderRadius: 8,
        padding: 12, color: '#eee', font: '13px system-ui', display: 'flex', flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <b style={{ fontSize: 15 }}>Recipe Book</b>
        <span style={{ flex: 1 }} />
        <button onClick={() => setOpen(false)} style={{ cursor: 'pointer', background: '#444', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 8px' }}>✕</button>
      </div>
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search…"
        style={{ marginBottom: 10, padding: '6px 8px', borderRadius: 4, border: '1px solid #444', background: '#111', color: '#eee', font: '13px system-ui' }}
      />

      <div style={{ overflowY: 'auto', flex: 1 }}>
        <div style={{ opacity: 0.6, margin: '4px 0' }}>Crafting <span style={{ fontSize: 11 }}>(click to craft · shift = all)</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
          {visibleCrafts.map((r) => {
            const can = inventory.hasAll(r.requirements);
            return (
              <Icon key={r.id} name={r.result.item} dim={!can}
                onClick={(e) => can && craft(r, e.shiftKey)}
                onEnter={() => setHover({ type: 'craft', r })} onLeave={() => setHover(null)} />
            );
          })}
        </div>

        <div style={{ opacity: 0.6, margin: '12px 0 4px' }}>Smelting <span style={{ fontSize: 11 }}>(use a furnace)</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
          {visibleSmelts.map((r) => (
            <Icon key={r.input} name={r.output}
              onEnter={() => setHover({ type: 'smelt', r })} onLeave={() => setHover(null)} />
          ))}
        </div>
      </div>

      {/* Tooltip */}
      {hover && (
        <div style={{
          position: 'fixed', left: Math.min(mouse.x + 14, window.innerWidth - 200), top: mouse.y + 10,
          background: '#0e0f13', border: '1px solid #4a4a6a', borderRadius: 6, padding: 8,
          font: '12px system-ui', color: '#eee', pointerEvents: 'none', zIndex: 16, minWidth: 150,
        }}>
          {hover.type === 'craft' ? (
            <>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {display(hover.r.result.item)}{hover.r.result.count > 1 ? ` ×${hover.r.result.count}` : ''}
              </div>
              {hover.r.requirements.map((req) => {
                const have = inventory.count(req.item);
                return (
                  <div key={req.item} style={{ color: have >= req.count ? '#a8e6a0' : '#e8a0a0' }}>
                    {display(req.item)}: {have}/{req.count}
                  </div>
                );
              })}
            </>
          ) : (
            <div>{display(hover.r.input)} → {display(hover.r.output)} <span style={{ opacity: 0.6 }}>(smelt)</span></div>
          )}
        </div>
      )}
    </div>
  );
}
