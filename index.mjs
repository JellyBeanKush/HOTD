import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';
import fs from 'fs';

const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    DISCORD_URL: process.env.DISCORD_WEBHOOK_URL,
    SAVE_FILE: 'current_horoscope.txt',
    HISTORY_FILE: 'horoscope_history.json',
    ID_FILE: 'message_id.txt', // NEW: Stores the ID to edit
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

    // If we have an ID, we EDIT (?wait=true is required for webhooks to return data)
    const url = messageId 
        ? `${CONFIG.DISCORD_URL}/messages/${messageId}` 
        : `${CONFIG.DISCORD_URL}?wait=true`;

    const response = await fetch(url, { 
        method: messageId ? 'PATCH' : 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(payload) 
    });

    if (!messageId && response.ok) {
        const result = await response.json();
        fs.writeFileSync(CONFIG.ID_FILE, result.id); // Save ID for tomorrow
        console.log("First message posted and ID saved.");
    } else if (response.ok) {
        console.log("Existing message updated successfully.");
    } else {
        console.error("Discord update failed:", await response.text());
    }
}

async function main() {
    let history = [];
    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
        try { 
            history = JSON.parse(fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8')); 
        } catch (e) { history = []; }
    }

    if (history.length > 0 && history[0].date === todayFormatted) {
        console.log("Already updated today.");
        return;
    }

    const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);
    const model = genAI.getGenerativeModel({ model: CONFIG.PRIMARY_MODEL });

    const prompt = `Act as a professional astrologer. Analyze the actual planetary transits for ${todayFormatted}.
    Write a brief 1-2 sentence "summary" of the overall energy.
    For EACH of the 12 signs, write exactly TWO punchy sentences. 
    Sentence 1: The astrological transit. Sentence 2: Practical advice.
    JSON ONLY: {
      "summary": "Overall vibe",
      "signs": [
        {"name": "Aries", "emoji": "♈", "text": "Two sentences..."},
        {"name": "Taurus", "emoji": "♉", "text": "Two sentences..."},
        {"name": "Gemini", "emoji": "♊", "text": "Two sentences..."},
        {"name": "Cancer", "emoji": "♋", "text": "Two sentences..."},
        {"name": "Leo", "emoji": "♌", "text": "Two sentences..."},
        {"name": "Virgo", "emoji": "♍", "text": "Two sentences..."},
        {"name": "Libra", "emoji": "♎", "text": "Two sentences..."},
        {"name": "Scorpio", "emoji": "♏", "text": "Two sentences..."},
        {"name": "Sagittarius", "emoji": "♐", "text": "Two sentences..."},
        {"name": "Capricorn", "emoji": "♑", "text": "Two sentences..."},
        {"name": "Aquarius", "emoji": "♒", "text": "Two sentences..."},
        {"name": "Pisces", "emoji": "♓", "text": "Two sentences..."}
      ]
    }`;

    try {
        const result = await model.generateContent(prompt);
        const data = JSON.parse(result.response.text().replace(/```json|```/g, "").trim());
        data.date = todayFormatted;

        fs.writeFileSync(CONFIG.SAVE_FILE, JSON.stringify(data, null, 2));
        data.signs.forEach(sign => {
            fs.writeFileSync(`current_${sign.name.toLowerCase()}.txt`, sign.text);
        });

        history.unshift({ date: todayFormatted });
        fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(history.slice(0, 30), null, 2));

        await updateDiscord(data);
    } catch (err) {
        console.error("Error:", err);
        process.exit(1);
    }
}

main();
