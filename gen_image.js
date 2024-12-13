const {
    GoogleGenerativeAI,
    HarmCategory,
    HarmBlockThreshold,
} = require("@google/generative-ai");

const TIMEOUT_SECONDS = 30;
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas'); // Using node-canvas for image manipulation
require('dotenv').config();

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
    console.error("Error: GEMINI_API_KEY environment variable not set. Please set it in your .env file.");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
});

const generationConfig = {
    temperature: 1,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 8192,
};

const systemPrompt = `You are an expert image generator. Generate ONLY a very short base64 string representing a single row of pixels.

Rules:
1. Output ONLY the base64 string - nothing else
2. Keep the string as SHORT as possible
3. Each row must be exactly the requested width
4. Return empty string "" if failed

Example of desired length: "iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4"`;

async function run() {
    function isValidBase64(str) {
        try {
            return btoa(atob(str)) == str;
        } catch (err) {
            return false;
        }
    }

    const chatSession = model.startChat({
        generationConfig,
        history: [{
          role: 'user',
          parts: [{ text: systemPrompt }]
        }],
    });

    const userStory = "a majestic mountain landscape"; // Define the user story here.
    const imageWidth = 256; // Define the desired image dimensions
    const imageHeight = 256;
    const fileName = 'generated_image.png';
    const filePath = path.join(__dirname, fileName)


    const canvas = createCanvas(imageWidth, imageHeight);
    const ctx = canvas.getContext('2d');


    let prevRowBase64 = "";
    console.log("Starting image generation process...");
    const startTime = performance.now();
    try {
        for (let i = 0; i < imageHeight; i++) {
            const prompt = `Generate row ${i+1}/${imageHeight} of "${userStory}". Width: ${imageWidth}px. Return ONLY shortest possible base64.`;
            console.log(`Generating row ${i + 1}...`);
            
            const messageStartTime = performance.now();
            const result = await Promise.race([
                chatSession.sendMessage(prompt),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), TIMEOUT_SECONDS * 1000)
                )
            ]);
            const messageEndTime = performance.now();
            console.log(`Row ${i+1} sent and received. Time taken: ${((messageEndTime - messageStartTime) / 1000).toFixed(2)} seconds`);

            let base64String = result.response.text().trim();
            
            // Validate base64 string
            if (base64String && isValidBase64(base64String)) {
                try {
                    const image = await loadImage(`data:image/png;base64,${base64String}`);
                    ctx.drawImage(image, 0, i, imageWidth, 1); // Draw just one row
                    prevRowBase64 = base64String;
                } catch (imgError) {
                    console.warn(`Warning: Could not process row ${i+1}, using blank row instead`);
                    ctx.fillStyle = 'white';
                    ctx.fillRect(0, i, imageWidth, 1);
                }
            } else {
                console.warn(`Warning: Invalid base64 for row ${i+1}, using blank row`);
                ctx.fillStyle = 'white';
                ctx.fillRect(0, i, imageWidth, 1);
            }

            // Save progress every 10 rows
            if (i % 10 === 0 || i === imageHeight - 1) {
                const imageBuffer = canvas.toBuffer('image/png');
                fs.writeFileSync(filePath, imageBuffer);
                console.log(`Progress saved at row ${i+1}`);
            }
        }
         console.log("All Rows Generated")


    } catch (error) {
        if (error.message === 'Timeout') {
            console.warn("Timeout occurred - using blank row");
            ctx.fillStyle = 'white';
            ctx.fillRect(0, i, imageWidth, 1);
            continue;
        }
        console.error("Error during image generation:", error);
        break;
    }

     const endTime = performance.now();
     console.log(`Total execution time: ${((endTime - startTime) / 1000).toFixed(2)} seconds`);
}

run();
