const {
    GoogleGenerativeAI,
    HarmCategory,
    HarmBlockThreshold,
} = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');
const { default: open } = require('open');

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

async function run() {
    const chatSession = model.startChat({
        generationConfig,
        history: [],
    });

      const prompt = `Generate a base64 encoded image of a cute cat playing with a ball of yarn. Provide only the base64 string in your response, nothing else.`;

    try {
        const result = await chatSession.sendMessage(prompt);
        const base64String = result.response.text();

        if (base64String && base64String.trim().length > 0) {
            const htmlContent = `
              <!DOCTYPE html>
              <html>
              <head>
                  <title>Generated Image</title>
              </head>
              <body>
                  <img src="data:image/png;base64,${base64String}" alt="Generated Image">
              </body>
              </html>
            `;

          const fileName = 'generated_image.html';
          const filePath = path.join(__dirname, fileName)

            fs.writeFileSync(filePath, htmlContent);

            console.log("HTML file created at:", filePath);

            // Open the HTML file in the default browser
            await open(filePath);
          
        } else {
            console.error("Error: No base64 string received from the model.");
            console.log("Full response from model:", result);
        }
    } catch (error) {
        console.error("Error during image generation:", error);
    }
}

run();
