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

    // PATCH edits the existing message; POST creates a new one
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
        fs.writeFileSync(CONFIG.ID_FILE, result.id);
        console.log("First message created. ID saved to message_id.txt.");
    } else if (response.ok) {
        console.log("Horoscope message updated successfully.");
    } else {
        const errorText = await response.text();
        console.error("Discord Error:", errorText);
        // If message was deleted manually, clear the ID to post fresh next time
        if (response.status === 404) fs.unlinkSync(CONFIG.ID_FILE);
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
    Write a 1-2 sentence "summary" of the overall energy.
    For EACH of the 12 signs, write exactly TWO sentences. 
    Sentence 1: The astrological transit. Sentence 2: Practical advice.
    JSON ONLY: {
      "summary": "Overall vibe",
      "signs": [
        {"name": "Aries", "emoji": "♈", "text": "..."},
        {"name": "Taurus", "emoji": "♉", "text": "..."},
        {"name": "Gemini", "emoji": "♊", "text": "..."},
        {"name": "Cancer", "emoji": "♋", "text": "..."},
        {"name": "Leo", "emoji": "♌", "text": "..."},
        {"name": "Virgo", "emoji": "♍", "text": "..."},
        {"name": "Libra", "emoji": "♎", "text": "..."},
        {"name": "Scorpio", "emoji": "♏", "text": "..."},
        {"name": "Sagittarius", "emoji": "♐", "text": "..."},
        {"name": "Capricorn", "emoji": "♑", "text": "..."},
        {"name": "Aquarius", "emoji": "♒", "text": "..."},
        {"name": "Pisces", "emoji": "♓", "text": "..."}
      ]
    }`;

    try {
        const result = await model.generateContent(prompt);
        const data = JSON.parse(result.response.text().replace(/```json|```/g, "").trim());
        data.date = todayFormatted;

        // Save main data
        fs.writeFileSync(CONFIG.SAVE_FILE, JSON.stringify(data, null, 2));

        // Individual files for Mix It Up
        data.signs.forEach(sign => {
            fs.writeFileSync(`current_${sign.name.toLowerCase()}.txt`, sign.text);
        });

        // Update history log
        history.unshift({ date: todayFormatted });
        fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(history.slice(0, 30), null, 2));

        await updateDiscord(data);
    } catch (err) {
        console.error("Critical Failure:", err);
        process.exit(1);
    }
}

main();
