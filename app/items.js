// Vibequest gear: templates, crafting recipes and how each piece is drawn on top of the 32x32 viber sprite.
// Shared by the server (crafting) and the browser (rendering). Coordinates are sprite pixels (see viber.js layout:
// head x7-25 y7-24, visor y11-19, shoulders y26-31, antenna y1-6).
(function (root) {
  const RARITY = {
    common:    { label: "Common",    color: "#b7bdc0", power: [1, 2],  glow: null },
    rare:      { label: "Rare",      color: "#5b9dff", power: [3, 4],  glow: "rgba(91,157,255,.35)" },
    epic:      { label: "Epic",      color: "#b26bff", power: [5, 7],  glow: "rgba(178,107,255,.4)" },
    legendary: { label: "Legendary", color: "#ffd23f", power: [8, 10], glow: "rgba(255,210,63,.45)" },
    mythic:    { label: "Mythic",    color: "#ff4b6e", power: [11, 13], glow: "rgba(255,75,110,.5)" },
  };
  // materials per craft tier; on failure half of each material comes back
  const RECIPES = {
    common:    { cost: { copper: 5 },           chance: 1.00 },
    rare:      { cost: { copper: 5, silver: 3 }, chance: 0.90 },
    epic:      { cost: { silver: 3, gold: 2 },   chance: 0.75 },
    legendary: { cost: { gold: 2, diamond: 1 },  chance: 0.60 },
    mythic:    { cost: { diamond: 2 },           chance: 0.50, embersOnly: true },   // plus Embers (vq_prices.forge_mythic)
  };
  // extra Ember price per tier once $VQUEST is live (keys in vq_prices)
  const EMBER_KEY = { epic: "forge_epic", legendary: "forge_legendary", mythic: "forge_mythic" };
  const SLOTS = { head: "Head", eyes: "Eyes", body: "Body", aura: "Aura", pet: "Pet" };

  // px: [x, y, w, h, color] rectangles drawn over the sprite
  const T = [
    // head
    { id: "cap",        slot: "head", rarity: "common",    name: "Trader Cap",      px: [[7, 5, 18, 3, "#2a6df4"], [18, 7, 9, 1, "#1d4fb8"], [8, 5, 16, 1, "#4f8bff"]] },
    { id: "beanie",     slot: "head", rarity: "common",    name: "Night Beanie",    px: [[7, 4, 18, 4, "#3a3f45"], [7, 7, 18, 1, "#555b62"], [15, 2, 2, 2, "#dff902"]] },
    { id: "headset",    slot: "head", rarity: "rare",      name: "Desk Headset",    px: [[5, 9, 2, 9, "#1b1e21"], [25, 9, 2, 9, "#1b1e21"], [6, 5, 20, 2, "#1b1e21"], [4, 11, 3, 5, "#dff902"], [25, 11, 3, 5, "#dff902"]] },
    { id: "wizard",     slot: "head", rarity: "epic",      name: "Curve Wizard Hat", px: [[6, 7, 20, 2, "#5a2bb8"], [9, 4, 14, 3, "#6a35d6"], [12, 1, 8, 3, "#7a45e6"], [15, -2, 3, 3, "#8a55f6"], [11, 5, 2, 2, "#ffd23f"], [19, 3, 2, 2, "#ffd23f"]] },
    { id: "crown",      slot: "head", rarity: "legendary", name: "Graduation Crown", px: [[9, 3, 14, 4, "#ffd23f"], [9, 1, 2, 2, "#ffd23f"], [15, 0, 2, 3, "#ffd23f"], [21, 1, 2, 2, "#ffd23f"], [12, 4, 2, 2, "#ff4b6e"], [18, 4, 2, 2, "#3ee6d0"], [9, 6, 14, 1, "#c99a12"]] },
    { id: "halo",       slot: "head", rarity: "legendary", name: "Diamond Halo",    px: [[10, 0, 12, 1, "#8fe9ff"], [9, 1, 1, 1, "#8fe9ff"], [22, 1, 1, 1, "#8fe9ff"], [10, 2, 12, 1, "#8fe9ff"], [12, 1, 8, 1, "#ffffff55"]] },
    // eyes
    { id: "shades",     slot: "eyes", rarity: "common",    name: "Floor Shades",    px: [[9, 13, 14, 4, "#0b0c0e"], [10, 13, 3, 1, "#ffffff40"], [17, 13, 3, 1, "#ffffff40"]] },
    { id: "monocle",    slot: "eyes", rarity: "rare",      name: "Analyst Monocle", px: [[18, 12, 6, 6, "#ffd23f"], [19, 13, 4, 4, "#8fe9ff80"], [23, 18, 1, 5, "#ffd23f"]] },
    { id: "laser",      slot: "eyes", rarity: "epic",      name: "Sniper Laser Visor", px: [[8, 14, 16, 3, "#ff2d55"], [8, 15, 16, 1, "#ffb3c1"]] },
    { id: "diamondeye", slot: "eyes", rarity: "legendary", name: "Diamond Eyes",    px: [[10, 13, 4, 4, "#8fe9ff"], [18, 13, 4, 4, "#8fe9ff"], [10, 13, 2, 2, "#ffffff"], [18, 13, 2, 2, "#ffffff"]] },
    // body
    { id: "hoodie",     slot: "body", rarity: "common",    name: "Degen Hoodie",    px: [[7, 26, 18, 6, "#2f3a46"], [14, 26, 4, 3, "#1f2730"], [9, 28, 2, 4, "#dff902"]] },
    { id: "jacket",     slot: "body", rarity: "rare",      name: "Launch Jacket",   px: [[7, 26, 18, 6, "#1d4fb8"], [15, 26, 2, 6, "#dff902"], [7, 26, 2, 6, "#163c8c"], [23, 26, 2, 6, "#163c8c"]] },
    { id: "armor",      slot: "body", rarity: "epic",      name: "Curve Plate",     px: [[7, 26, 18, 6, "#6b7280"], [9, 27, 14, 2, "#9aa3ad"], [15, 27, 2, 5, "#b26bff"], [7, 26, 3, 3, "#9aa3ad"], [22, 26, 3, 3, "#9aa3ad"]] },
    { id: "goldarmor",  slot: "body", rarity: "legendary", name: "Treasury Armor",  px: [[7, 26, 18, 6, "#ffd23f"], [9, 27, 14, 2, "#fff1a8"], [14, 28, 4, 3, "#c99a12"], [15, 29, 2, 1, "#ff4b6e"], [6, 26, 3, 3, "#ffe57a"], [23, 26, 3, 3, "#ffe57a"]] },
    // aura (drawn as an animated glow by the renderer; px are sparkles)
    { id: "spark",      slot: "aura", rarity: "rare",      name: "Spark Aura",      aura: "#5b9dff", px: [[3, 6, 1, 1, "#ffffff"], [28, 10, 1, 1, "#ffffff"], [2, 22, 1, 1, "#ffffff"]] },
    { id: "flame",      slot: "aura", rarity: "epic",      name: "Pump Flame",      aura: "#ff7a1a", px: [[4, 26, 2, 2, "#ffb03b"], [26, 26, 2, 2, "#ffb03b"], [5, 20, 1, 2, "#ff7a1a"], [27, 20, 1, 2, "#ff7a1a"]] },
    { id: "rainbow",    slot: "aura", rarity: "legendary", name: "Graduation Aura", aura: "rainbow", px: [[3, 4, 1, 1, "#ffd23f"], [29, 6, 1, 1, "#8fe9ff"], [1, 18, 1, 1, "#ff7ad9"], [30, 22, 1, 1, "#dff902"]] },
    // pets (drawn next to the character, 10x10 sprites)
    { id: "cat",        slot: "pet",  rarity: "rare",      name: "Chart Cat",       pet: [[1, 2, 1, 2, "#f2f4f3"], [7, 2, 1, 2, "#f2f4f3"], [1, 3, 7, 5, "#f2f4f3"], [2, 5, 1, 1, "#0b0c0e"], [6, 5, 1, 1, "#0b0c0e"], [4, 6, 1, 1, "#ff7ad9"], [8, 6, 2, 1, "#f2f4f3"], [2, 8, 1, 1, "#b7bdc0"], [6, 8, 1, 1, "#b7bdc0"]] },
    { id: "rocket",     slot: "pet",  rarity: "rare",      name: "Mini Rocket",     pet: [[4, 0, 2, 1, "#ff6b57"], [3, 1, 4, 6, "#f2f4f3"], [4, 3, 2, 2, "#5b9dff"], [2, 5, 1, 3, "#ff6b57"], [7, 5, 1, 3, "#ff6b57"], [4, 7, 2, 1, "#ffd23f"], [4, 8, 2, 2, "#ff7a1a"]] },
    { id: "dragon",     slot: "pet",  rarity: "epic",      name: "Liquidity Dragon", pet: [[2, 2, 6, 5, "#3ecf6e"], [7, 1, 3, 3, "#3ecf6e"], [8, 2, 1, 1, "#0b0c0e"], [0, 1, 3, 2, "#2a9d55"], [3, 7, 1, 2, "#2a9d55"], [6, 7, 1, 2, "#2a9d55"], [1, 4, 1, 2, "#ffd23f"], [3, 3, 3, 1, "#7ff0a0"]] },
    // mythic: only forged with Embers
    { id: "phoenixcrown", slot: "head", rarity: "mythic", name: "Phoenix Crown", px: [[8, 3, 16, 4, "#ff4b6e"], [8, 0, 2, 3, "#ff7a1a"], [12, -1, 2, 4, "#ffd23f"], [15, -3, 2, 6, "#ff4b6e"], [18, -1, 2, 4, "#ffd23f"], [22, 0, 2, 3, "#ff7a1a"], [10, 4, 2, 2, "#ffffff"], [20, 4, 2, 2, "#ffffff"], [8, 6, 16, 1, "#9a1f3a"]] },
    { id: "oracle",       slot: "eyes", rarity: "mythic", name: "Oracle Eyes",   px: [[9, 13, 5, 4, "#ff4b6e"], [18, 13, 5, 4, "#ff4b6e"], [10, 14, 3, 2, "#ffe0e7"], [19, 14, 3, 2, "#ffe0e7"], [14, 14, 4, 1, "#ff4b6e"]] },
    { id: "mech",         slot: "body", rarity: "mythic", name: "Mainnet Mech",  px: [[6, 26, 20, 6, "#2b2e35"], [8, 27, 16, 2, "#ff4b6e"], [14, 28, 4, 4, "#dff902"], [4, 25, 4, 5, "#4a4f5a"], [24, 25, 4, 5, "#4a4f5a"], [5, 26, 2, 1, "#ff4b6e"], [25, 26, 2, 1, "#ff4b6e"]] },
    { id: "supernova",    slot: "aura", rarity: "mythic", name: "Supernova",     aura: "#ff4b6e", px: [[2, 3, 2, 2, "#ffffff"], [28, 5, 2, 2, "#ffd23f"], [1, 16, 1, 1, "#ff4b6e"], [30, 18, 1, 1, "#ffffff"], [3, 27, 2, 2, "#dff902"], [27, 28, 2, 2, "#ff7a1a"]] },
    { id: "phoenix",      slot: "pet",  rarity: "mythic", name: "Phoenix",       pet: [[3, 1, 4, 3, "#ff4b6e"], [6, 1, 2, 1, "#ffd23f"], [5, 2, 1, 1, "#0b0c0e"], [2, 4, 6, 3, "#ff7a1a"], [0, 3, 2, 3, "#ffd23f"], [8, 3, 2, 3, "#ffd23f"], [3, 7, 1, 3, "#ff4b6e"], [6, 7, 1, 3, "#ff4b6e"], [4, 4, 2, 1, "#ffe0e7"]] },
    { id: "frog",       slot: "pet",  rarity: "legendary", name: "Golden Frog",     pet: [[1, 3, 8, 5, "#ffd23f"], [1, 2, 3, 2, "#ffd23f"], [6, 2, 3, 2, "#ffd23f"], [2, 2, 1, 1, "#0b0c0e"], [7, 2, 1, 1, "#0b0c0e"], [3, 6, 4, 1, "#c99a12"], [0, 7, 2, 2, "#ffe57a"], [8, 7, 2, 2, "#ffe57a"]] },
  ];
  // commons for the slots that have none: auras/pets start at rare, so a common craft there rolls another slot
  const BY = (slot, rarity) => T.filter(t => t.slot === slot && t.rarity === rarity);

  function drawGear(ctx, gear, x0, y0, s, time) {   // gear: { slot: template id }
    for (const slot of ["body", "eyes", "head", "aura"]) {
      const t = T.find(x => x.id === gear[slot]); if (!t || !t.px) continue;
      for (const [x, y, w, h, c] of t.px) {
        if (slot === "aura" && Math.sin((time || 0) / 300 + x) < -0.2) continue;   // twinkle
        ctx.fillStyle = c; ctx.fillRect(x0 + x * s, y0 + y * s, w * s, h * s);
      }
    }
  }
  function drawPet(ctx, id, x0, y0, s) {
    const t = T.find(x => x.id === id); if (!t || !t.pet) return;
    for (const [x, y, w, h, c] of t.pet) { ctx.fillStyle = c; ctx.fillRect(x0 + x * s, y0 + y * s, w * s, h * s); }
  }
  const api = { RARITY, RECIPES, EMBER_KEY, SLOTS, TEMPLATES: T, BY, drawGear, drawPet };
  if (typeof module !== "undefined") module.exports = api; else root.Items = api;
})(this);
