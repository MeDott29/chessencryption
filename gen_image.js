const {
    GoogleGenerativeAI,
    HarmCategory,
    HarmBlockThreshold,
} = require("@google/generative-ai");

const INITIAL_TIMEOUT = 30; // 30 seconds initial timeout
const MAX_RETRIES = 3;
const BACKOFF_MULTIPLIER = 2;
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
    temperature: 0.4,  // Reduce from 0.7 to get more consistent outputs
    topP: 0.8,
    topK: 40,
    maxOutputTokens: 1024,  // Reduce since we only need one row of pixels
};

const imageWidth = 256; // Define the desired image dimensions
const imageHeight = 256;

const systemPrompt = `You are an image generator that creates base64 encoded PNG data for single pixel rows.
Each row must be exactly ${imageWidth} pixels wide and 1 pixel tall.
Output only the base64 string, no other text.
The base64 string should represent a valid PNG image.`;

async function run() {
    function isValidBase64(str) {
        // Check if string exists and has valid base64 characters
        if (!str || !/^[A-Za-z0-9+/]*={0,2}$/.test(str)) {
            return false;
        }

        try {
            // Decode and check if it's actually a PNG
            const buffer = Buffer.from(str, 'base64');
            // PNG files start with these bytes
            const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
            return buffer.length > 8 && 
                   pngSignature.every((byte, i) => buffer[i] === byte);
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
    const fileName = 'generated_image.png';
    const filePath = path.join(__dirname, fileName)


    const canvas = createCanvas(imageWidth, imageHeight);
    const ctx = canvas.getContext('2d');


    let prevRowBase64 = "";
    console.log("Starting image generation process...");
    const startTime = performance.now();
    try {
        for (let i = 0; i < imageHeight; i++) {
                const prompt = `Row ${i+1}/${imageHeight} of "${userStory}". Width: ${imageWidth}px. Base64 only.`;
                console.log(`Generating row ${i + 1}...`);
                
                const messageStartTime = performance.now();
                let timeout = INITIAL_TIMEOUT;
                let retries = 0;
                let success = false;
                let result;

                while (retries < MAX_RETRIES && !success) {
                    try {
                        result = await Promise.race([
                            chatSession.sendMessage(prompt),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('Timeout')), timeout * 1000)
                            )
                        ]);
                        success = true;
                    } catch (error) {
                        retries++;
                        if (retries < MAX_RETRIES) {
                            console.warn(`Attempt ${retries} timed out after ${timeout}s, waiting before retry...`);
                            await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second pause between retries
                            timeout *= BACKOFF_MULTIPLIER;
                        } else {
                            console.warn("Max retries reached - using previous row or blank");
                            if (prevRowBase64) {
                                try {
                                    const image = await loadImage(`data:image/png;base64,${prevRowBase64}`);
                                    ctx.drawImage(image, 0, i, imageWidth, 1);
                                } catch {
                                    ctx.fillStyle = 'white';
                                    ctx.fillRect(0, i, imageWidth, 1);
                                }
                            } else {
                                ctx.fillStyle = 'white';
                                ctx.fillRect(0, i, imageWidth, 1);
                            }
                            break;
                        }
                    }
                }
                
                if (success) {
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
            }
        console.log("All Rows Generated");

        const endTime = performance.now();
        console.log(`Total execution time: ${((endTime - startTime) / 1000).toFixed(2)} seconds`);
    } catch (error) {
        console.error("Fatal error during image generation:", error);
        const endTime = performance.now();
        console.log(`Execution terminated after: ${((endTime - startTime) / 1000).toFixed(2)} seconds`);
    }
}

run();
