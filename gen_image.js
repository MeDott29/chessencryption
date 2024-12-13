const {
    GoogleGenerativeAI,
    HarmCategory,
    HarmBlockThreshold,
} = require("@google/generative-ai");

require('dotenv').config();
const fs = require('fs');

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
    console.error("Error: GEMINI_API_KEY environment variable not set. Please set it in your .env file.");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

const model = genAI.getGenerativeModel({
    model: "gemini-1.5-pro", // Make sure you're using a model that supports image generation
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
             try {
               const imageBuffer = Buffer.from(base64String, 'base64');

                // Save to file to make sure it works
                fs.writeFileSync('generated_image.png', imageBuffer)

               // Try displaying the image inline (may only work on some terminals)
               const displayCommand = `\u001b]1337;File=inline=1;width=200;height=200;preserveAspectRatio=1;content=${base64String}\u0007`;
               console.log(displayCommand);
            } catch(error) {
                 console.error("Error decoding or displaying the image:", error);
                 console.log("You should manually decode the base64 string from generated_image.png to see the image")
                 console.log(base64String)
            }



        } else {
            console.error("Error: No base64 string received from the model.");
            console.log("Full response from model:", result);
        }
    } catch (error) {
        console.error("Error during image generation:", error);
    }
}

run();