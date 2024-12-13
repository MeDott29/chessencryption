const {
    GoogleGenerativeAI,
    HarmCategory,
    HarmBlockThreshold,
} = require("@google/generative-ai");
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
    model: "gemini-1.5-pro",
});

const generationConfig = {
    temperature: 1,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 8192,
};

const systemPrompt = `You are an expert image generator. Your primary function is to generate a single row of pixels of an image based on user requests, then convert the row of pixels into a compact base64 string format as a direct response. You must **always** respond with ONLY the base64 string of the generated row of image data, and nothing else.

**Important Rules:**
1. **Base64 Output Only:** Output ONLY the base64 encoded image string representing a single row of pixels, no text or other information.
2. **Compact Output:** Generate the smallest possible base64 string while maintaining image quality.
3. **Row Size:** Each row must be exactly the requested width in pixels.
4. **No Errors or Explanations**: Provide an empty string "" if generation fails.

Remember to keep the base64 string as small as possible while maintaining image quality.

**Example Output:**

For the prompt "Generate a base64 encoded image row of a red square", the response must be similar to (but different):
\`iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GAAXDIBKE0DHxgljNBAAAAABJRU5ErkJggg==\`

For the prompt "Generate a base64 encoded image row of a blue circle", the response must be similar to (but different):
\`iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAAEnQAABJ0Ad5mH3gAAACiSURBVEhL7dEBCQAADMOl/x+E+l8wZ8jE9Vj8yU1k/c9d3U4qC9A/n90AAAAASUVORK5CYII=\`

**Remember, your responses should be ONLY the base64 string of a single row of pixels, and nothing else.**
`;

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
            const prompt = `Generate a base64 encoded image row representing row number ${i+1} of ${imageHeight} for ${userStory}. The row should be exactly ${imageWidth} pixels wide. Make the base64 string as small as possible while maintaining image quality.`;
            console.log(`Generating row ${i + 1}...`);
            
            const messageStartTime = performance.now();
            const result = await chatSession.sendMessage(prompt);
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
        console.error("Error during image generation:", error);
    }

     const endTime = performance.now();
     console.log(`Total execution time: ${((endTime - startTime) / 1000).toFixed(2)} seconds`);
}

run();
