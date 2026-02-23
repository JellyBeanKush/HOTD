import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';
import fs from 'fs';

const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    DISCORD_URL: process.env.DISCORD_WEBHOOK_URL, // e.g., .../TOKEN?thread_id=123
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
            color: 10180886
        }]
    };

    let messageId = null;
    if (fs.existsSync(CONFIG.ID_FILE)) {
        messageId = fs.readFileSync(CONFIG.ID_FILE, 'utf8').trim();
    }

    // --- CLEAN URL LOGIC ---
    // 1. Get the base URL (ID and Token) and the thread_id separately
    const urlObj = new URL(CONFIG.DISCORD_URL);
    const threadId = urlObj.searchParams.get('thread_id');
    
    // 2. Build the correct path
    let finalUrl = `${urlObj.origin}${urlObj.pathname}`;
    if (messageId) {
        finalUrl += `/messages/${messageId}`;
    }

    // 3. Add parameters back correctly
    const finalParams = new URLSearchParams();
    if (threadId) finalParams.set('thread_id', threadId);
    if (!messageId) finalParams.set('wait', 'true'); // Required to get ID back on first post

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
            console.log("First post successful. ID saved.");
        } else {
            console.log("Existing message updated successfully.");
        }
    } else {
        const err = await response.text();
        console.error(`Discord Error: ${response.status}`, err);
        // Reset if message was deleted manually
        if (response.status === 404 && messageId) fs.unlinkSync(CONFIG.ID_FILE);
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
    Write a 2-3 sentence summary of the overall energy.
    For EACH of the 12 signs, write exactly TWO sentences. 
    JSON ONLY: {
      "summary": "Overall vibe",
      "signs": [
        {"name": "Aries", "emoji": "♈", "text": "Two sentences..."},
        ... (repeat for all 12 signs)
      ]
    }`;

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
