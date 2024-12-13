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

const systemPrompt = `You are an expert image generator. Your primary function is to generate a single row of pixels of an image based on user requests, then convert the row of pixels into a proportionate base64 string format as a direct response. You must **always** respond with ONLY the base64 string of the generated row of image data, and nothing else. The base64 string must represent the entire row.

**Important Rules:**
1.  **Base64 Output Only:** You will output ONLY the base64 encoded image string representing a single row of pixels, no text, explanations, or any other information.
2.  **No Errors, Exceptions or Explanations**: Do not provide any error, explanations or warnings. If you cannot generate the image, provide an empty string "".
3. **Sequential Row Generation**: You will be generating an image row by row based on the previous row you've generated.

**Example Output:**

For the prompt "Generate a base64 encoded image row of a red square", the response must be similar to (but different):
\`iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GAAXDIBKE0DHxgljNBAAAAABJRU5ErkJggg==\`

For the prompt "Generate a base64 encoded image row of a blue circle", the response must be similar to (but different):
\`iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAAEnQAABJ0Ad5mH3gAAACiSURBVEhL7dEBCQAADMOl/x+E+l8wZ8jE9Vj8yU1k/c9d3U4qC9A/n90AAAAASUVORK5CYII=\`

**Remember, your responses should be ONLY the base64 string of a single row of pixels, and nothing else.**
`;

async function run() {
    const chatSession = model.startChat({
        generationConfig,
        history: [{
          role: 'user',
          parts: [{ text: systemPrompt }]
        }],
    });

    const userStory = "a majestic mountain landscape"; // Define the user story here.
    const imageWidth = 512; // Define the desired image dimensions
    const imageHeight = 512;
    const fileName = 'generated_image.png';
    const filePath = path.join(__dirname, fileName)


    const canvas = createCanvas(imageWidth, imageHeight);
    const ctx = canvas.getContext('2d');


    let prevRowBase64 = "";
    console.log("Starting image generation process...");
    const startTime = performance.now();
    try {
        for (let i = 0; i < imageHeight; i++) {
             const prompt = `Generate a base64 encoded image row representing row number ${i+1} of ${imageHeight} for ${userStory}. Here is the previous row if it is available: ${prevRowBase64}`;
            console.log(`Generating row ${i + 1}...`);
            
            const messageStartTime = performance.now();
            const result = await chatSession.sendMessage(prompt);
            const messageEndTime = performance.now();
            console.log(`Row ${i+1} sent and received. Time taken: ${((messageEndTime - messageStartTime) / 1000).toFixed(2)} seconds`);

            const base64String = result.response.text();

            if (base64String && base64String.trim().length > 0) {
                 const image = await loadImage(`data:image/png;base64,${base64String}`);
                 ctx.drawImage(image, 0, i);
                 prevRowBase64 = base64String;
            
            } else {
                 console.error("Error: No base64 string received from the model.");
                // Handle missing row (you might want to break or fill with a default row)
                prevRowBase64 = "";
            }


            const imageBuffer = canvas.toBuffer('image/png');
            fs.writeFileSync(filePath, imageBuffer);
             console.log(`Image updated at ${filePath}`);

        }
         console.log("All Rows Generated")


    } catch (error) {
        console.error("Error during image generation:", error);
    }

     const endTime = performance.now();
     console.log(`Total execution time: ${((endTime - startTime) / 1000).toFixed(2)} seconds`);
}

run();