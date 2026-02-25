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
    // 1. Create the Header Embed (Summary)
    const embeds = [
        {
            title: `DAILY HOROSCOPE - ${todayFormatted}`,
            description: `**Current Cosmic Energy:** ${horoscopeData.summary}`,
            color: 10180886
        }
    ];

    // 2. Add an individual embed for each sign
    horoscopeData.signs.forEach(s => {
        embeds.push({
            title: `${s.emoji} ${s.name.toUpperCase()}`,
            description: s.text,
            color: 10180886
        });
    });

    const payload = { embeds };

    let messageId = null;
    if (fs.existsSync(CONFIG.ID_FILE)) {
        messageId = fs.readFileSync(CONFIG.ID_FILE, 'utf8').trim();
    }

    // --- URL LOGIC ---
    const urlObj = new URL(CONFIG.DISCORD_URL);
    const threadId = urlObj.searchParams.get('thread_id');
    
    let finalUrl = `${urlObj.origin}${urlObj.pathname}`;
    if (messageId) {
        finalUrl += `/messages/${messageId}`;
    }

    const finalParams = new URLSearchParams();
    if (threadId) finalParams.set('thread_id', threadId);
    if (!messageId) finalParams.set('wait', 'true');

    const requestUrl = `${finalUrl}?${finalParams.toString()}`;

    console.log(messageId ? "Attempting to edit message..." : "Sending new message...");

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
        const errText = await response.text();
        console.error(`Discord Error: ${response.status}`, errText);
        
        // If message was deleted (404) or payload was bad (400), clear the ID so next run starts fresh
        if ((response.status === 404 || response.status === 400) && messageId) {
            console.log("Cleaning up ID file to reset for next run.");
            fs.unlinkSync(CONFIG.ID_FILE);
        }
    }
}

async function main() {
    let history = [];
    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
        try { 
            history = JSON.parse(fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8')); 
        } catch (e) {
            history = [];
        }
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
        const textResponse = result.response.text();
        const cleanJson = textResponse.replace(/```json|```/g, "").trim();
        const data = JSON.parse(cleanJson);
        
        data.date = todayFormatted;

        // Save local backups
        fs.writeFileSync(CONFIG.SAVE_FILE, JSON.stringify(data, null, 2));
        data.signs.forEach(s => fs.writeFileSync(`current_${s.name.toLowerCase()}.txt`, s.text));
        
        // Update history
        history.unshift({ date: todayFormatted });
        fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(history.slice(0, 30), null, 2));

        await updateDiscord(data);
    } catch (err) {
        console.error("Critical Failure:", err);
        process.exit(1);
    }
}

main();
