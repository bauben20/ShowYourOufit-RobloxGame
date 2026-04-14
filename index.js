const express   = require("express");
const fetch     = require("node-fetch");
const app       = express();
const PORT      = process.env.PORT || 3000;

// Tu clave secreta — la misma que ponés en Roblox
// Cambiala por cualquier string largo y aleatorio
const SECRET_KEY = process.env.SECRET_KEY || "cambia_esta_clave_secreta_123";

// ─────────────────────────────────────────────
// Convierte UserId → UniverseId del juego
// "lugar por defecto" = el primer lugar del juego del usuario
// ─────────────────────────────────────────────
async function getUniverseId(userId) {
    // Obtenemos los juegos del usuario
    const gamesUrl = `https://games.roblox.com/v2/users/${userId}/games?limit=50&sortOrder=Asc`;
    const res  = await fetch(gamesUrl);
    const data = await res.json();

    if (!data.data || data.data.length === 0) return null;

    // Tomamos el primer juego (el más antiguo, generalmente el "por defecto")
    return data.data[0].id;
}

// ─────────────────────────────────────────────
// Obtiene todos los Game Passes de un universo
// ─────────────────────────────────────────────
async function getGamePasses(universeId) {
    let passes  = [];
    let cursor  = "";

    // Roblox pagina los resultados, los recorremos todos
    do {
        const url = `https://games.roblox.com/v1/games/${universeId}/game-passes?limit=100&sortOrder=Asc${cursor ? "&cursor=" + cursor : ""}`;
        const res  = await fetch(url);
        const data = await res.json();

        if (!data.data) break;

        for (const pass of data.data) {
            passes.push({
                id:    pass.id,
                name:  pass.name,
                price: pass.price || 0
            });
        }

        cursor = data.nextPageCursor || "";
    } while (cursor);

    return passes;
}

// ─────────────────────────────────────────────
// Endpoint que consulta Roblox desde tu juego
// GET /passes?userId=123456&key=tu_clave
// ─────────────────────────────────────────────
app.get("/passes", async (req, res) => {
    const { userId, key } = req.query;

    // Validamos la clave secreta
    if (key !== SECRET_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    if (!userId || isNaN(userId)) {
        return res.status(400).json({ error: "userId inválido" });
    }

    try {
        const universeId = await getUniverseId(Number(userId));

        if (!universeId) {
            return res.json({ passes: [], note: "El jugador no tiene juegos públicos" });
        }

        const passes = await getGamePasses(universeId);
        return res.json({ passes });

    } catch (err) {
        console.error("[Error]", err.message);
        return res.status(500).json({ error: "Error interno", detail: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
