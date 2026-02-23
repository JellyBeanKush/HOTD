import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';
import fs from 'fs';

const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    DISCORD_URL: process.env.DISCORD_WEBHOOK_URL,
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

    const embed = {
        title: `DAILY HOROSCOPE - ${todayFormatted}`,
        description: `**Current Cosmic Energy:** ${horoscopeData.summary}\n\n${horoscopeList}`,
        color: 10180886
    };

    let messageId = null;
    if (fs.existsSync(CONFIG.ID_FILE)) {
        messageId = fs.readFileSync(CONFIG.ID_FILE, 'utf8').trim();
    }

    // Split the URL to handle thread_id correctly
    const [webhookBase, query] = CONFIG.DISCORD_URL.split('?');
    let finalUrl = webhookBase;

    // If we have an ID, we append /messages/ID to the path
    if (messageId) {
        finalUrl += `/messages/${messageId}`;
    }

    // Rebuild the query string (ensuring wait=true for the first post)
    const params = new URLSearchParams(query || "");
    if (!messageId) params.set('wait', 'true');
    
    const requestUrl = `${finalUrl}?${params.toString()}`;

    const response = await fetch(requestUrl, { 
        method: messageId ? 'PATCH' : 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ embeds: [embed] }) 
    });

    if (response.ok) {
        if (!messageId) {
            const result = await response.json();
            fs.writeFileSync(CONFIG.ID_FILE, result.id);
            console.log("Success: Posted and saved ID.");
        } else {
            console.log("Success: Updated existing message.");
        }
    } else {
        const errorMsg = await response.text();
        console.error(`Discord Error: ${response.status}`, errorMsg);
        // If message was manually deleted, remove ID to start fresh
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
    Write a 1-2 sentence summary of the overall energy.
    For EACH of the 12 signs, write exactly TWO sentences (Transit + Advice).
    JSON ONLY: { "summary": "vibe", "signs": [ {"name": "Aries", "emoji": "♈", "text": "..."} ] }`;

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
