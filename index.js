const fetch = require("node-fetch");
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || "thisisthemegarobloxgamepass_392938498";

app.use(cors());

// ─────────────────────────────────────────────
// Helper: espera X milisegundos
// ─────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────
// Helper: fetch con reintentos y backoff
// ─────────────────────────────────────────────
async function fetchWithRetry(url, retries = 4, delayMs = 1500) {
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const res = await fetch(url, {
                headers: {
                    "Accept": "application/json",
                    "User-Agent": "Mozilla/5.0"
                }
            });

            if (res.status === 429) {
                const wait = delayMs * Math.pow(2, attempt);
                console.warn(`[RateLimit] Intento ${attempt + 1} — esperando ${wait}ms | ${url}`);
                await sleep(wait);
                continue;
            }

            return res;
        } catch (err) {
            if (attempt === retries - 1) throw err;
            await sleep(delayMs);
        }
    }
    return null;
}

// ─────────────────────────────────────────────
// Obtiene los juegos del usuario
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
        if (cursor) await sleep(300);
    } while (cursor);

    return games;
}

// ─────────────────────────────────────────────
// Obtiene Game Passes de un universo
// Endpoint correcto y vigente de Roblox (2025+)
// ─────────────────────────────────────────────
async function getPassesForUniverse(universeId) {
    let passes = [];
    let cursor = "";

    do {
        const url = `https://games.roblox.com/v1/games/${universeId}/game-passes?sortOrder=Asc&limit=100${cursor ? "&cursor=" + cursor : ""}`;
        const res = await fetchWithRetry(url);

        if (!res) {
            console.warn(`[getPassesForUniverse] Sin respuesta para universo ${universeId}`);
            break;
        }

        if (res.status === 404) {
            // El juego no tiene passes o no existe — no es error crítico
            break;
        }

        if (!res.ok) {
            console.warn(`[getPassesForUniverse] status: ${res.status} para universo ${universeId}`);
            break;
        }

        const data = await res.json();
        if (!data.data || data.data.length === 0) break;

        for (const p of data.data) {
            if (p.price !== null && p.price !== undefined && p.price > 0) {
                passes.push({
                    id:    p.id,
                    name:  p.name,
                    price: p.price,
                    type:  "gamepass"
                });
            }
        }

        cursor = data.nextPageCursor || "";
        if (cursor) await sleep(300);
    } while (cursor);

    return passes;
}

// ─────────────────────────────────────────────
// Obtiene ítems del catálogo del usuario
// SECUENCIAL para no disparar rate-limit
// ─────────────────────────────────────────────
async function getCatalogItems(userId, subcategory, type) {
    let items = [];
    let cursor = "";

    do {
        const url = `https://catalog.roblox.com/v1/search/items/details?Category=3&Subcategory=${subcategory}&CreatorTargetId=${userId}&CreatorType=User&limit=30${cursor ? "&cursor=" + cursor : ""}`;
        const res = await fetchWithRetry(url);

        if (!res) {
            console.warn(`[getCatalogItems] Sin respuesta para tipo ${type}`);
            break;
        }

        if (!res.ok) {
            console.warn(`[getCatalogItems] tipo ${type} status: ${res.status}`);
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
        if (cursor) await sleep(500);
    } while (cursor);

    return items;
}

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

        // 2. Game Passes — SECUENCIAL con pausa entre universos para evitar 429
        let passes = [];
        for (const game of games) {
            const gamePasses = await getPassesForUniverse(game.universeId);
            passes.push(...gamePasses);
            await sleep(400);
        }
        console.log(`[Debug] Passes encontrados para ${parsedId}:`, passes.length);

        // 3. Cosméticos — SECUENCIAL, uno por vez con pausa entre cada uno
        const shirts  = await getCatalogItems(parsedId, 12, "shirt");
        await sleep(700);
        const pants   = await getCatalogItems(parsedId, 13, "pants");
        await sleep(700);
        const tshirts = await getCatalogItems(parsedId, 11, "tshirt");

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

        let samplePasses = [];
        if (games.length > 0) {
            samplePasses = await getPassesForUniverse(games[0].universeId);
        }

        const sampleShirts = await getCatalogItems(parsedId, 12, "shirt");

        return res.json({
            userId: parsedId,
            gamesFound: games.length,
            games,
            samplePasses,
            sampleShirts
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
