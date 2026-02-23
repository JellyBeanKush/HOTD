import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';
import fs from 'fs';

const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    DISCORD_URL: process.env.DISCORD_WEBHOOK_URL, // Use the base Webhook URL without thread_id in secrets if possible, or we handle it below
    SAVE_FILE: 'current_horoscope.txt',
    HISTORY_FILE: 'horoscope_history.json',
    ID_FILE: 'message_id.txt', 
    PRIMARY_MODEL: "gemini-2.5-flash" 
};

const options = { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' };
const todayFormatted = new Date().toLocaleDateString('en-US', options);

async function updateDiscord(horoscopeData) {
    const horoscopeList = horoscopeData.signs.map(s => 
        `**${s.emoji} ${s.name.toUpperCase()}**\n${s.text}`
    ).join('\n\n');

    const payload = {
        embeds: [{
            title: `DAILY HOROSCOPE - ${todayFormatted}`,
            description: `**Current Cosmic Energy:** ${horoscopeData.summary}\n\n${horoscopeList}`,
            color: 0x9b59b6,
            footer: { text: "Calculated based on actual planetary transits via Gemini 2.5 Flash." }
        }]
    };

    let messageId = null;
    if (fs.existsSync(CONFIG.ID_FILE)) {
        messageId = fs.readFileSync(CONFIG.ID_FILE, 'utf8').trim();
    }

    // CLEAN URL HANDLING
    let urlString = CONFIG.DISCORD_URL;
    const urlObj = new URL(urlString);
    
    if (messageId) {
        // To EDIT: URL must be .../messages/ID
        urlObj.pathname += `/messages/${messageId}`;
    } else {
        // To POST & get ID back: need wait=true
        urlObj.searchParams.set('wait', 'true');
    }

    const response = await fetch(urlObj.toString(), { 
        method: messageId ? 'PATCH' : 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(payload) 
    });

    if (!messageId && response.ok) {
        const result = await response.json();
        fs.writeFileSync(CONFIG.ID_FILE, result.id);
        console.log("First message created and ID saved.");
    } else if (response.ok) {
        console.log("Horoscope message updated successfully.");
    } else {
        console.error("Discord Error:", await response.text());
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

    const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);
    const model = genAI.getGenerativeModel({ model: CONFIG.PRIMARY_MODEL });

    const prompt = `Act as a professional astrologer. Analyze actual planetary transits for ${todayFormatted}. 
    Write a 1-2 sentence "summary" of the overall energy.
    For EACH of the 12 signs, write exactly TWO sentences (Transit + Advice).
    JSON ONLY: { "summary": "vibe", "signs": [{"name": "Aries", "emoji": "♈", "text": "..."}] }`;

    try {
        const result = await model.generateContent(prompt);
        const data = JSON.parse(result.response.text().replace(/```json|```/g, "").trim());
        data.date = todayFormatted;

        fs.writeFileSync(CONFIG.SAVE_FILE, JSON.stringify(data, null, 2));
        data.signs.forEach(s => fs.writeFileSync(`current_${s.name.toLowerCase()}.txt`, s.text));
        
        history.unshift({ date: todayFormatted });
        fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(history.slice(0, 30), null, 2));

        await updateDiscord(data);
    } catch (err) {
        console.error("Critical Failure:", err);
        process.exit(1);
    }
}
main();
