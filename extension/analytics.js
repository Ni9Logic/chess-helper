// ---------------------------------------------------------------------------
// Analytics Module
// Tracks per-game and cross-game statistics, stored in chrome.storage.local.
// Provides accuracy, CPL, opening repertoire, and performance dashboard data.
// ---------------------------------------------------------------------------

const analytics = (() => {
    const STORAGE_KEY = "trainerAnalytics";
    const MAX_GAMES = 50; // keep last 50 games

    let data = { games: [], bookmarks: [] };

    const load = async () => {
        try {
            const stored = await chrome.storage.local.get(STORAGE_KEY);
            data = stored[STORAGE_KEY] || { games: [], bookmarks: [] };
        } catch { data = { games: [], bookmarks: [] }; }
    };

    const save = async () => {
        try { await chrome.storage.local.set({ [STORAGE_KEY]: data }); } catch { }
    };

    // Record a completed game
    const recordGame = async (gameData) => {
        await load();
        const entry = {
            date: Date.now(),
            site: location.hostname,
            opening: gameData.openingName || "Unknown",
            moveCount: gameData.fenHistory?.length || 0,
            classifications: gameData.classifications || [],
            avgCpl: computeAvgCpl(gameData),
            accuracy: computeAccuracy(gameData),
            blunders: (gameData.classifications || []).filter(c => c === "blunder").length,
            mistakes: (gameData.classifications || []).filter(c => c === "mistake").length,
            inaccuracies: (gameData.classifications || []).filter(c => c === "inaccuracy").length,
            brilliancies: (gameData.classifications || []).filter(c => c === "brilliant").length,
        };
        data.games.push(entry);
        if (data.games.length > MAX_GAMES) data.games = data.games.slice(-MAX_GAMES);
        await save();
        return entry;
    };

    const computeAvgCpl = (gameData) => {
        const evals = (gameData.evalHistory || []).filter(e => e?.score);
        if (evals.length < 2) return 0;
        let totalCpl = 0, count = 0;
        for (let i = 1; i < evals.length; i++) {
            const prev = parseScore(evals[i - 1].score);
            const curr = parseScore(evals[i].score);
            if (prev !== null && curr !== null) {
                totalCpl += Math.abs(curr - prev);
                count++;
            }
        }
        return count ? Math.round(totalCpl / count) : 0;
    };

    const computeAccuracy = (gameData) => {
        const c = gameData.classifications || [];
        const scored = c.filter(x => x);
        if (!scored.length) return 100;
        const weights = { brilliant: 100, great: 98, good: 90, inaccuracy: 60, mistake: 30, blunder: 0 };
        const total = scored.reduce((sum, cl) => sum + (weights[cl] ?? 70), 0);
        return Math.round(total / scored.length);
    };

    const parseScore = (score) => {
        if (typeof score === "number") return score;
        if (typeof score !== "string") return null;
        if (score.startsWith("Mate")) return null;
        const parsed = parseFloat(score);
        return isNaN(parsed) ? null : parsed * 100;
    };

    // Save a position bookmark
    const addBookmark = async (fen, label = "") => {
        await load();
        data.bookmarks.push({ fen, label, date: Date.now() });
        if (data.bookmarks.length > 100) data.bookmarks = data.bookmarks.slice(-100);
        await save();
    };

    const getBookmarks = async () => {
        await load();
        return data.bookmarks;
    };

    // Get stats for dashboard
    const getStats = async () => {
        await load();
        const games = data.games;
        if (!games.length) return null;

        const recent10 = games.slice(-10);
        const avgAccuracy = Math.round(recent10.reduce((s, g) => s + g.accuracy, 0) / recent10.length);
        const avgCpl = Math.round(recent10.reduce((s, g) => s + g.avgCpl, 0) / recent10.length);
        const totalBlunders = recent10.reduce((s, g) => s + g.blunders, 0);
        const totalBrilliancies = recent10.reduce((s, g) => s + g.brilliancies, 0);

        // Opening repertoire
        const openingStats = {};
        for (const g of games) {
            if (!openingStats[g.opening]) {
                openingStats[g.opening] = { count: 0, totalAccuracy: 0 };
            }
            openingStats[g.opening].count++;
            openingStats[g.opening].totalAccuracy += g.accuracy;
        }
        const topOpenings = Object.entries(openingStats)
            .map(([name, s]) => ({ name, count: s.count, avgAccuracy: Math.round(s.totalAccuracy / s.count) }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        // Accuracy trend
        const accuracyTrend = games.slice(-20).map((g, i) => ({ game: i + 1, accuracy: g.accuracy }));

        return {
            gamesPlayed: games.length,
            avgAccuracy,
            avgCpl,
            totalBlunders,
            totalBrilliancies,
            topOpenings,
            accuracyTrend,
            recentGames: recent10.map(g => ({
                date: g.date,
                opening: g.opening,
                accuracy: g.accuracy,
                blunders: g.blunders,
                moves: g.moveCount,
            })),
        };
    };

    // Opponent style profiling
    const profileOpponent = (moveHistory) => {
        const classifications = moveHistory?.classifications || [];
        const scored = classifications.filter(x => x);
        if (scored.length < 5) return null;

        const aggressiveCount = scored.filter(c => c === "brilliant" || c === "great").length;
        const passiveCount = scored.filter(c => c === "good" || c === "inaccuracy").length;
        const blunderCount = scored.filter(c => c === "blunder" || c === "mistake").length;

        const total = scored.length;
        const aggressiveRatio = aggressiveCount / total;
        const errorRatio = blunderCount / total;

        let style = "Balanced";
        if (aggressiveRatio > 0.4) style = "Aggressive";
        else if (passiveCount / total > 0.6) style = "Positional";
        if (errorRatio > 0.3) style += " (Error-prone)";
        else if (errorRatio < 0.1) style += " (Solid)";

        return {
            style,
            accuracy: computeAccuracy(moveHistory),
            aggressiveness: Math.round(aggressiveRatio * 100),
            errorRate: Math.round(errorRatio * 100),
        };
    };

    return { load, recordGame, addBookmark, getBookmarks, getStats, profileOpponent };
})();

if (typeof globalThis !== "undefined") {
    globalThis.analytics = analytics;
}
