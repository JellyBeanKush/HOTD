import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';
import fs from 'fs';

const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    DISCORD_URL: process.env.DISCORD_WEBHOOK_URL,
    SAVE_FILE: 'current_horoscope.txt',
    HISTORY_FILE: 'horoscope_history.json',
    ID_FILE: 'message_id.txt',
    MODELS: ["gemini-flash-latest", "gemini-pro-latest", "gemini-2.5-flash", "gemini-1.5-flash"]
};

const options = { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' };
const todayFormatted = new Date().toLocaleDateString('en-US', options);

async function updateDiscord(horoscopeData) {
    const embeds = [{
        title: `DAILY HOROSCOPE - ${todayFormatted}`,
        description: `**Current Cosmic Energy:** ${horoscopeData.summary}`,
        color: 10180886
    }];

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
        embeds.push({ title: group.name, description: groupText, color: 10180886 });
    });

    let messageId = fs.existsSync(CONFIG.ID_FILE) ? fs.readFileSync(CONFIG.ID_FILE, 'utf8').trim() : null;
    const urlObj = new URL(CONFIG.DISCORD_URL);
    const threadId = urlObj.searchParams.get('thread_id');
    let finalUrl = `${urlObj.origin}${urlObj.pathname}${messageId ? `/messages/${messageId}` : ""}`;
    
    const params = new URLSearchParams();
    if (threadId) params.set('thread_id', threadId);
    if (!messageId) params.set('wait', 'true');

    const response = await fetch(`${finalUrl}?${params}`, { 
        method: messageId ? 'PATCH' : 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ embeds }) 
    });

    if (response.ok && !messageId) {
        const result = await response.json();
        fs.writeFileSync(CONFIG.ID_FILE, result.id);
    }
}

async function main() {
    let history = fs.existsSync(CONFIG.HISTORY_FILE) ? JSON.parse(fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8')) : [];
    if (history.length > 0 && history[0].date === todayFormatted) return;

    const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);
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

    for (const modelName of CONFIG.MODELS) {
        try {
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent(prompt);
            const responseText = result.response.text();
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            const data = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
            data.date = todayFormatted;

            fs.writeFileSync(CONFIG.SAVE_FILE, JSON.stringify(data, null, 2));
            data.signs.forEach(sign => {
                fs.writeFileSync(`current_${sign.name.toLowerCase()}.txt`, `${sign.emoji} ${sign.name.toUpperCase()} - ${todayFormatted}\n\n${sign.text}`);
            });

            history.unshift({ date: todayFormatted });
            fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(history, null, 2)); // INFINITE
            await updateDiscord(data);
            return;
        } catch (err) {
            console.warn(`${modelName} failed, trying next...`);
        }
    }
}
main();
