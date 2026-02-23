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
        color: 10180886 // Purple
    };

    let messageId = null;
    if (fs.existsSync(CONFIG.ID_FILE)) {
        messageId = fs.readFileSync(CONFIG.ID_FILE, 'utf8').trim();
    }

    // Build the URL correctly for Threads
    const url = new URL(CONFIG.DISCORD_URL);
    const threadId = url.searchParams.get('thread_id');

    if (messageId) {
        // Prepare URL for PATCH (Edit)
        url.search = ''; // Clear existing params for pathname edit
        url.pathname += `/messages/${messageId}`;
        if (threadId) url.searchParams.set('thread_id', threadId);
    } else {
        // Prepare URL for POST (New Message)
        url.searchParams.set('wait', 'true');
    }

    const response = await fetch(url.toString(), { 
        method: messageId ? 'PATCH' : 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ embeds: [embed] }) 
    });

    if (response.ok) {
        if (!messageId) {
            const result = await response.json();
            fs.writeFileSync(CONFIG.ID_FILE, result.id);
            console.log("Success: Posted first message.");
        } else {
            console.log("Success: Updated existing message.");
        }
    } else {
        const error = await response.text();
        console.error(`Discord Error ${response.status}:`, error);
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
    Focus on the February 2026 Aquarius Stellium.
    Write a 1-2 sentence "summary" of the overall energy.
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
