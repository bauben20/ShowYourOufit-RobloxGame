const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || "thisisthemegarobloxgamepass_392938498";

// ─────────────────────────────────────────────
// Obtiene los Game Passes que un usuario tiene
// en su INVENTARIO (passes que él mismo compró
// o que creó en sus juegos)
// ─────────────────────────────────────────────
async function getPassesFromInventory(userId) {
    let passes = [];
    let cursor = "";

    do {
        const url = `https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?assetType=GamePass&limit=100${cursor ? "&cursor=" + cursor : ""}`;
        const res  = await fetch(url);
        const data = await res.json();

        console.log("[Debug inventory]", JSON.stringify(data));

        if (!data.data) break;

        for (const item of data.data) {
            passes.push({
                id:    item.assetId,
                name:  item.name,
                price: item.recentAveragePrice || 0
            });
        }

        cursor = data.nextPageCursor || "";
    } while (cursor);

    return passes;
}

// ─────────────────────────────────────────────
// Obtiene los Game Passes de TODOS los juegos
// del usuario usando la API de catalog
// ─────────────────────────────────────────────
async function getPassesFromCatalog(userId) {
    let passes = [];
    let cursor = "";

    do {
        const url = `https://catalog.roblox.com/v1/search/items/details?Category=GamePass&CreatorTargetId=${userId}&CreatorType=User&limit=30${cursor ? "&cursor=" + cursor : ""}`;
        const res  = await fetch(url);
        const data = await res.json();

        console.log("[Debug catalog]", JSON.stringify(data));

        if (!data.data) break;

        for (const item of data.data) {
            if (item.price && item.price > 0) {
                passes.push({
                    id:    item.id,
                    name:  item.name,
                    price: item.price
                });
            }
        }

        cursor = data.nextPageCursor || "";
    } while (cursor);

    return passes;
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
        // Intentamos primero con catalog (más confiable para passes a la venta)
        let passes = await getPassesFromCatalog(parsedId);

        // Si catalog no devuelve nada, probamos con inventory
        if (passes.length === 0) {
            console.log("[Debug] Catalog vacío, probando inventory...");
            passes = await getPassesFromInventory(parsedId);
        }

        // Filtramos duplicados por id
        const seen  = new Set();
        passes = passes.filter(p => {
            if (seen.has(p.id)) return false;
            seen.add(p.id);
            return true;
        });

        console.log(`[Debug] Total passes encontrados para ${parsedId}:`, passes.length);
        return res.json({ passes });

    } catch (err) {
        console.error("[Error]", err.message);
        return res.status(500).json({ error: "Error interno", detail: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
