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
            footer: { text: "Calculated based on the February 2026 Aquarius Stellium transits." }
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
       (Note: Sun is in Pisces, there is a massive Stellium in Aquarius with Mercury, Venus, and Mars, and Sun squares Uranus today).
    2. Write a brief "summary" (1-2 sentences) of this heavy Aquarius/Pisces energy.
    3. For EACH of the 12 signs, write exactly TWO sentences. 
       - Sentence 1: Mention the specific transit affecting them (e.g., "With Mars entering your social sector...").
       - Sentence 2: Provide practical, grounded advice for their day.
    Keep it insightful and streamer-friendly. No cringe.
    JSON ONLY: {
      "summary": "Overall vibe",
      "signs": [
        {"name": "Aries", "emoji": "♈", "text": "Two sentences here."},
        {"name": "Taurus", "emoji": "♉", "text": "Two sentences here."},
        {"name": "Gemini", "emoji": "♊", "text": "Two sentences here."},
        {"name": "Cancer", "emoji": "♋", "text": "Two sentences here."},
        {"name": "Leo", "emoji": "♌", "text": "Two sentences here."},
        {"name": "Virgo", "emoji": "♍", "text": "Two sentences here."},
        {"name": "Libra", "emoji": "♎", "text": "Two sentences here."},
        {"name": "Scorpio", "emoji": "♏", "text": "Two sentences here."},
        {"name": "Sagittarius", "emoji": "♐", "text": "Two sentences here."},
        {"name": "Capricorn", "emoji": "♑", "text": "Two sentences here."},
        {"name": "Aquarius", "emoji": "♒", "text": "Two sentences here."},
        {"name": "Pisces", "emoji": "♓", "text": "Two sentences here."}
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
        console.log("Horoscopes posted!");
    } catch (err) {
        console.error("Generation Error:", err);
        process.exit(1);
    }
}
main();
