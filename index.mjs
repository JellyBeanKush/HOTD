import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';
import fs from 'fs';

const CONFIG = {
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    DISCORD_URL: process.env.DISCORD_WEBHOOK_URL,
    SAVE_FILE: 'current_horoscope.txt',
    HISTORY_FILE: 'horoscope_history.json',
    PRIMARY_MODEL: "gemini-2.5-flash"
};

const options = { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' };
const todayFormatted = new Date().toLocaleDateString('en-US', options);

async function postToDiscord(horoscopeData) {
    const fields = horoscopeData.signs.map(s => ({
        name: `${s.emoji} ${s.name.toUpperCase()}`,
        value: s.text,
        inline: true
    }));

    const payload = {
        embeds: [{
            title: `DAILY HOROSCOPE - ${todayFormatted}`,
            description: `**Current Cosmic Energy:** ${horoscopeData.summary}`,
            color: 0x9b59b6,
            fields: fields,
            footer: { text: "Calculated based on current planetary transits." }
        }]
    };

    await fetch(CONFIG.DISCORD_URL, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(payload) 
    });
}

async function main() {
    let history = [];
    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
        try { history = JSON.parse(fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8')); } catch (e) {}
    }

    if (history.length > 0 && history[0].date === todayFormatted) {
        console.log("Already posted today.");
        return;
    }

    const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);
    const model = genAI.getGenerativeModel({ model: CONFIG.PRIMARY_MODEL });

    const prompt = `Act as a professional astrologer.
    1. Analyze the actual planetary transits for ${todayFormatted}.
    2. Write a brief "summary" (1-2 sentences) of the overall cosmic energy.
    3. For EACH of the 12 signs, write exactly TWO sentences. 
       - The first sentence should mention a specific astrological influence for today.
       - The second sentence should be a practical application or advice.
    Keep it grounded, insightful, and brief. No cringe.
    JSON ONLY: {
      "summary": "Overall vibe",
      "signs": [
        {"name": "Aries", "emoji": "♈", "text": "Two sentence horoscope here."},
        ... (repeat for all 12 signs)
      ]
    }`;

    try {
        const result = await model.generateContent(prompt);
        const data = JSON.parse(result.response.text().replace(/```json|```/g, "").trim());
        data.date = todayFormatted;

        fs.writeFileSync(CONFIG.SAVE_FILE, JSON.stringify(data, null, 2));
        history.unshift({ date: todayFormatted });
        fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(history.slice(0, 30), null, 2));

        await postToDiscord(data);
        console.log("Two-sentence horoscopes posted successfully!");
    } catch (err) {
        console.error("Error generating horoscopes:", err);
        process.exit(1);
    }
}
main();
