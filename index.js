const fetch = require("node-fetch");
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || "thisisthemegarobloxgamepass_392938498";

app.use(cors());

// ─────────────────────────────────────────────
// Helper: fetch con reintentos ante rate-limit
// ─────────────────────────────────────────────
async function fetchWithRetry(url, retries = 3, delayMs = 1000) {
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const res = await fetch(url, {
                headers: { "Accept": "application/json" }
            });

            if (res.status === 429) {
                console.warn(`[RateLimit] ${url} — esperando ${delayMs}ms`);
                await new Promise(r => setTimeout(r, delayMs));
                delayMs *= 2;
                continue;
            }

            return res;
        } catch (err) {
            if (attempt === retries - 1) throw err;
            await new Promise(r => setTimeout(r, delayMs));
        }
    }
}

// ─────────────────────────────────────────────
// Obtiene los juegos del usuario
// Usa la API v2 paginada
// ─────────────────────────────────────────────
async function getUserGames(userId) {
    let games = [];
    let cursor = "";

    do {
        const url = `https://games.roblox.com/v2/users/${userId}/games?accessFilter=Public&limit=50${cursor ? "&cursor=" + cursor : ""}`;
        const res = await fetchWithRetry(url);

        if (!res || !res.ok) {
            console.warn(`[getUserGames] status: ${res?.status}`);
            break;
        }

        const data = await res.json();
        if (!data.data || data.data.length === 0) break;

        for (const game of data.data) {
            games.push({
                placeId:    game.rootPlaceId,
                universeId: game.id,
                name:       game.name
            });
        }

        cursor = data.nextPageCursor || "";
    } while (cursor);

    return games;
}

// ─────────────────────────────────────────────
// Obtiene Game Passes de un universo
// Usa catalog.roblox.com que es más estable
// ─────────────────────────────────────────────
async function getPassesForUniverse(universeId) {
    let passes = [];
    let cursor = "";

    do {
        // Este endpoint es el más confiable para game passes públicos
        const url = `https://catalog.roblox.com/v1/search/items/details?Category=13&Subcategory=40&universeId=${universeId}&limit=30${cursor ? "&cursor=" + cursor : ""}`;
        const res = await fetchWithRetry(url);

        if (!res || !res.ok) {
            // Fallback: intentar con el endpoint de games directamente
            console.warn(`[getPassesForUniverse] catalog falló para universo ${universeId}, probando fallback...`);
            const fallbackPasses = await getPassesFallback(universeId);
            passes.push(...fallbackPasses);
            break;
        }

        const data = await res.json();
        if (!data.data || data.data.length === 0) break;

        for (const item of data.data) {
            if (item.price && item.price > 0) {
                passes.push({
                    id:    item.id,
                    name:  item.name,
                    price: item.price,
                    type:  "gamepass"
                });
            }
        }

        cursor = data.nextPageCursor || "";
    } while (cursor);

    return passes;
}

// ─────────────────────────────────────────────
// Fallback: endpoint oficial de game-passes
// games.roblox.com/v1/games/{universeId}/game-passes
// ─────────────────────────────────────────────
async function getPassesFallback(universeId) {
    let passes = [];
    let cursor = "";

    do {
        const url = `https://games.roblox.com/v1/games/${universeId}/game-passes?sortOrder=Asc&limit=100${cursor ? "&cursor=" + cursor : ""}`;
        const res = await fetchWithRetry(url);

        if (!res || !res.ok) {
            console.warn(`[getPassesFallback] status: ${res?.status} para universo ${universeId}`);
            break;
        }

        const data = await res.json();
        if (!data.data || data.data.length === 0) break;

        for (const p of data.data) {
            if (p.price && p.price > 0) {
                passes.push({
                    id:    p.id,
                    name:  p.name,
                    price: p.price,
                    type:  "gamepass"
                });
            }
        }

        cursor = data.nextPageCursor || "";
    } while (cursor);

    return passes;
}

// ─────────────────────────────────────────────
// Helper genérico para cosméticos del catálogo
// ─────────────────────────────────────────────
async function getCatalogItems(userId, subcategory, type) {
    let items = [];
    let cursor = "";

    do {
        const url = `https://catalog.roblox.com/v1/search/items/details?Category=3&Subcategory=${subcategory}&CreatorTargetId=${userId}&CreatorType=User&limit=30${cursor ? "&cursor=" + cursor : ""}`;
        const res = await fetchWithRetry(url);

        if (!res || !res.ok) {
            console.warn(`[getCatalogItems] tipo ${type} status: ${res?.status}`);
            break;
        }

        const data = await res.json();
        if (!data.data || data.data.length === 0) break;

        for (const item of data.data) {
            if (item.price && item.price > 0) {
                items.push({
                    id:    item.id,
                    name:  item.name,
                    price: item.price,
                    type
                });
            }
        }

        cursor = data.nextPageCursor || "";
    } while (cursor);

    return items;
}

// Subcategories: 11 = T-Shirts, 12 = Shirts, 13 = Pants
const getShirts  = (userId) => getCatalogItems(userId, 12, "shirt");
const getPants   = (userId) => getCatalogItems(userId, 13, "pants");
const getTshirts = (userId) => getCatalogItems(userId, 11, "tshirt");

// ─────────────────────────────────────────────
// Endpoint principal: /passes
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
        // 1. Juegos del usuario
        const games = await getUserGames(parsedId);
        console.log(`[Debug] Juegos encontrados para ${parsedId}:`, games.length);

        // 2. Game Passes de cada juego en paralelo (con límite de concurrencia)
        const CONCURRENCY = 5;
        let passes = [];
        for (let i = 0; i < games.length; i += CONCURRENCY) {
            const batch = games.slice(i, i + CONCURRENCY);
            const results = await Promise.all(batch.map(g => getPassesForUniverse(g.universeId)));
            passes.push(...results.flat());
        }

        // 3. Cosméticos en paralelo
        const [shirts, pants, tshirts] = await Promise.all([
            getShirts(parsedId),
            getPants(parsedId),
            getTshirts(parsedId)
        ]);

        // 4. Unir todo
        let allItems = [...passes, ...shirts, ...pants, ...tshirts];

        // 5. Deduplicar por tipo + id
        const seen = new Set();
        allItems = allItems.filter(item => {
            const k = `${item.type}-${item.id}`;
            if (seen.has(k)) return false;
            seen.add(k);
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
// Endpoint de diagnóstico: /debug
// ─────────────────────────────────────────────
app.get("/debug", async (req, res) => {
    const { userId, key } = req.query;

    if (key !== SECRET_KEY) return res.status(401).json({ error: "Unauthorized" });

    const parsedId = parseInt(userId);
    if (!userId || isNaN(parsedId)) return res.status(400).json({ error: "userId inválido" });

    try {
        const games = await getUserGames(parsedId);

        // También mostramos passes del primer juego para diagnóstico
        let samplePasses = [];
        if (games.length > 0) {
            samplePasses = await getPassesForUniverse(games[0].universeId);
        }

        return res.json({ games, samplePasses });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
