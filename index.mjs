import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';
import fs from 'fs';

const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    DISCORD_URL: process.env.DISCORD_WEBHOOK_URL,
    SAVE_FILE: 'current_horoscope.txt',
    HISTORY_FILE: 'horoscope_history.json',
    ID_FILE: 'message_id.txt',
    // Ordered from newest/cheapest to older reliable models
    MODELS: [
        "gemini-3.1-flash-lite-preview", 
        "gemini-3-flash-preview", 
        "gemini-2.5-flash", 
        "gemini-1.5-flash"
    ]
};

const options = { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' };
const todayFormatted = new Date().toLocaleDateString('en-US', options);

async function updateDiscord(horoscopeData) {
    const embeds = [
        {
            title: `DAILY HOROSCOPE - ${todayFormatted}`,
            description: `**Current Cosmic Energy:** ${horoscopeData.summary}`,
            color: 10180886
        }
    ];

    const groups = [
        { name: "🔥 FIRE SIGNS", indices: [0, 4, 8] },
        { name: "⛰️ EARTH SIGNS", indices: [1, 5, 9] },
        { name: "🌬️ AIR SIGNS", indices: [2, 6, 10] },
        { name: "💧 WATER SIGNS", indices: [3, 7, 11] }
    ];

    groups.forEach(group => {
        const groupText = group.indices.map(i => {
            const s = horoscopeData.signs[i];
            return `**${s.emoji} ${s.name.toUpperCase()}**\n${s.text}`;
        }).join('\n\n');

        embeds.push({
            title: group.name,
            description: groupText,
            color: 10180886
        });
    });

    const payload = { embeds };

    let messageId = null;
    if (fs.existsSync(CONFIG.ID_FILE)) {
        messageId = fs.readFileSync(CONFIG.ID_FILE, 'utf8').trim();
    }

    const urlObj = new URL(CONFIG.DISCORD_URL);
    const threadId = urlObj.searchParams.get('thread_id');
    let finalUrl = `${urlObj.origin}${urlObj.pathname}`;
    if (messageId) finalUrl += `/messages/${messageId}`;

    const finalParams = new URLSearchParams();
    if (threadId) finalParams.set('thread_id', threadId);
    if (!messageId) finalParams.set('wait', 'true');

    const requestUrl = `${finalUrl}?${finalParams.toString()}`;

    const response = await fetch(requestUrl, { 
        method: messageId ? 'PATCH' : 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(payload) 
    });

    if (response.ok) {
        if (!messageId) {
            const result = await response.json();
            fs.writeFileSync(CONFIG.ID_FILE, result.id);
            console.log("Post successful.");
        }
    } else {
        const errText = await response.text();
        console.error(`Discord Error: ${response.status}`, errText);
        if ((response.status === 404 || response.status === 400) && messageId) {
            fs.unlinkSync(CONFIG.ID_FILE);
        }
    }
}

async function main() {
    let history = [];
    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
        try { history = JSON.parse(fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8')); } catch (e) {}
    }

    if (history.length > 0 && history[0].date === todayFormatted) {
        console.log("Already updated today.");
        return;
    }

    const prompt = `Act as a professional astrologer. Analyze planetary transits for ${todayFormatted}. 
    JSON ONLY: {
      "summary": "2-3 sentences on overall energy",
      "signs": [
        {"name": "Aries", "emoji": "♈", "text": "Two unique sentences..."},
        {"name": "Taurus", "emoji": "♉", "text": "Two unique sentences..."},
        {"name": "Gemini", "emoji": "♊", "text": "Two unique sentences..."},
        {"name": "Cancer", "emoji": "♋", "text": "Two unique sentences..."},
        {"name": "Leo", "emoji": "♌", "text": "Two unique sentences..."},
        {"name": "Virgo", "emoji": "♍", "text": "Two unique sentences..."},
        {"name": "Libra", "emoji": "♎", "text": "Two sentences..."},
        {"name": "Scorpio", "emoji": "♏", "text": "Two sentences..."},
        {"name": "Sagittarius", "emoji": "♐", "text": "Two sentences..."},
        {"name": "Capricorn", "emoji": "♑", "text": "Two sentences..."},
        {"name": "Aquarius", "emoji": "♒", "text": "Two sentences..."},
        {"name": "Pisces", "emoji": "♓", "text": "Two sentences..."}
      ]
    }`;

    const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);

    for (const modelName of CONFIG.MODELS) {
        try {
            console.log(`Attempting generation with ${modelName}...`);
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent(prompt);
            const responseText = result.response.text();
            
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            const data = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
            data.date = todayFormatted;

            // Save Master File
            fs.writeFileSync(CONFIG.SAVE_FILE, JSON.stringify(data, null, 2));

            // Save Individual Signs
            data.signs.forEach(sign => {
                const fileName = `current_${sign.name.toLowerCase()}.txt`;
                const content = `${sign.emoji} ${sign.name.toUpperCase()} - ${todayFormatted}\n\n${sign.text}`;
                fs.writeFileSync(fileName, content);
            });

            history.unshift({ date: todayFormatted });
            fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(history.slice(0, 5), null, 2));

            await updateDiscord(data);
            console.log(`Successfully updated using ${modelName}`);
            return; // Exit main() on success
        } catch (err) {
            console.warn(`${modelName} failed: ${err.message}`);
            if (err.status === 429) {
                console.warn("Quota limit reached, trying next model...");
            }
            // Continue to next model in loop
        }
    }

    console.error("All models failed.");
    process.exit(1);
}

main();
