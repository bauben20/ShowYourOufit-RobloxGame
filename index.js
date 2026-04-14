const fetch = require("node-fetch");
const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || "thisisthemegarobloxgamepass_392938498";

// ─────────────────────────────────────────────
// Obtiene los juegos del usuario
// ─────────────────────────────────────────────
async function getUserGames(userId) {
    let games = [];
    let cursor = "";

    do {
        const url = `https://games.roblox.com/v2/users/${userId}/games?accessFilter=Public&limit=50${cursor ? "&cursor=" + cursor : ""}`;
        const res = await fetch(url);

        if (!res.ok) {
            console.warn("[Warn] games endpoint:", res.status);
            break;
        }

        const data = await res.json();
        if (!data.data) break;

        for (const game of data.data) {
            games.push({ id: game.rootPlaceId, universeId: game.id, name: game.name });
        }

        cursor = data.nextPageCursor || "";
    } while (cursor);

    return games;
}

const cors = require("cors");
app.use(cors());

// ─────────────────────────────────────────────
// Obtiene los Game Passes de un universo
// ─────────────────────────────────────────────
async function getPassesForUniverse(universeId) {
    let passes = [];
    let cursor = "";

    do {
        const url = `https://games.roblox.com/v1/games/${universeId}/game-passes?limit=100${cursor ? "&cursor=" + cursor : ""}`;
        const res = await fetch(url);

        if (!res.ok) {
            console.warn(`[Warn] Passes status ${res.status} para universo ${universeId}`);
            break;
        }

        const data = await res.json();
        if (!data.data || data.data.length === 0) break;

        // Recolectamos los IDs de los passes
        const ids = data.data.map(p => p.id);

        // Consultamos el precio de cada pass en lotes de 100
        const detailsUrl = `https://itemdetails.roblox.com/v1/game-passes?gamePassIds=${ids.join(",")}`;
        const detailsRes = await fetch(detailsUrl);

        if (detailsRes.ok) {
            const details = await detailsRes.json();
            const priceMap = {};
            for (const d of (details.data || [])) {
                priceMap[d.id] = d.price;
            }

            for (const pass of data.data) {
                const price = priceMap[pass.id];
                if (price && price > 0) {
                    passes.push({
                        id:    pass.id,
                        name:  pass.name,
                        price: price,
                        type:  "gamepass"
                    });
                }
            }
        } else {
            // Fallback: usar el price que venga directamente si existe
            for (const pass of data.data) {
                if (pass.price && pass.price > 0) {
                    passes.push({
                        id:    pass.id,
                        name:  pass.name,
                        price: pass.price,
                        type:  "gamepass"
                    });
                }
            }
        }

        cursor = data.nextPageCursor || "";
    } while (cursor);

    return passes;
}
// ─────────────────────────────────────────────
// Obtiene Shirts del usuario desde el catálogo
// ─────────────────────────────────────────────
async function getShirts(userId) {
    let items = [];
    let cursor = "";

    do {
        // Subcategory 12 = Shirts
        const url = `https://catalog.roblox.com/v1/search/items/details?Category=3&Subcategory=12&CreatorTargetId=${userId}&CreatorType=User&limit=30${cursor ? "&cursor=" + cursor : ""}`;
        const res = await fetch(url);

        if (!res.ok) break;

        const data = await res.json();
        if (!data.data) break;

        for (const item of data.data) {
            if (item.price && item.price > 0) {
                items.push({
                    id:    item.id,
                    name:  item.name,
                    price: item.price,
                    type:  "shirt"
                });
            }
        }

        cursor = data.nextPageCursor || "";
    } while (cursor);

    return items;
}

// ─────────────────────────────────────────────
// Obtiene Pants del usuario
// ─────────────────────────────────────────────
async function getPants(userId) {
    let items = [];
    let cursor = "";

    do {
        // Subcategory 13 = Pants
        const url = `https://catalog.roblox.com/v1/search/items/details?Category=3&Subcategory=13&CreatorTargetId=${userId}&CreatorType=User&limit=30${cursor ? "&cursor=" + cursor : ""}`;
        const res = await fetch(url);

        if (!res.ok) break;

        const data = await res.json();
        if (!data.data) break;

        for (const item of data.data) {
            if (item.price && item.price > 0) {
                items.push({
                    id:    item.id,
                    name:  item.name,
                    price: item.price,
                    type:  "pants"
                });
            }
        }

        cursor = data.nextPageCursor || "";
    } while (cursor);

    return items;
}

// ─────────────────────────────────────────────
// Obtiene T-Shirts del usuario
// ─────────────────────────────────────────────
async function getTshirts(userId) {
    let items = [];
    let cursor = "";

    do {
        // Subcategory 11 = T-Shirts
        const url = `https://catalog.roblox.com/v1/search/items/details?Category=3&Subcategory=11&CreatorTargetId=${userId}&CreatorType=User&limit=30${cursor ? "&cursor=" + cursor : ""}`;
        const res = await fetch(url);

        if (!res.ok) break;

        const data = await res.json();
        if (!data.data) break;

        for (const item of data.data) {
            if (item.price && item.price > 0) {
                items.push({
                    id:    item.id,
                    name:  item.name,
                    price: item.price,
                    type:  "tshirt"
                });
            }
        }

        cursor = data.nextPageCursor || "";
    } while (cursor);

    return items;
}

// ─────────────────────────────────────────────
// Endpoint principal
// ─────────────────────────────────────────────
app.get("/passes", async (req, res) => {
    const { userId, key } = req.query;

    if (key !== SECRET_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const parsedId = parseInt(userId);
    if (!userId || isNaN(parsedId) || parsedId <= 0) {
        return res.status(400).json({ error: "userId inválido" });
    }

    try {
        // 1. Buscar juegos del usuario
        const games = await getUserGames(parsedId);
        console.log(`[Debug] Juegos encontrados para ${parsedId}:`, games.length);

        // 2. Buscar passes de cada juego en paralelo
        const passArrays = await Promise.all(
            games.map(g => getPassesForUniverse(g.universeId))
        );
        let passes = passArrays.flat();

        // 3. Buscar cosméticos en paralelo
        const [shirts, pants, tshirts] = await Promise.all([
            getShirts(parsedId),
            getPants(parsedId),
            getTshirts(parsedId)
        ]);

        // 4. Unir todo
        let allItems = [...passes, ...shirts, ...pants, ...tshirts];

        // 5. Deduplicar por id
        const seen = new Set();
        allItems = allItems.filter(p => {
            const key = `${p.type}-${p.id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        console.log(`[Debug] Total items para ${parsedId}:`, allItems.length);
        return res.json({ passes: allItems });

    } catch (err) {
        console.error("[Error]", err.message);
        return res.status(500).json({ error: "Error interno", detail: err.message });
    }
});

// ─────────────────────────────────────────────
// Endpoint de diagnóstico (podés borrarlo luego)
// ─────────────────────────────────────────────
app.get("/debug", async (req, res) => {
    const { userId, key } = req.query;

    if (key !== SECRET_KEY) return res.status(401).json({ error: "Unauthorized" });

    const parsedId = parseInt(userId);
    if (!userId || isNaN(parsedId)) return res.status(400).json({ error: "userId inválido" });

    const games = await getUserGames(parsedId);
    return res.json({ games });
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
