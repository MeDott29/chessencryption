const {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} = require("@google/generative-ai");
require('dotenv').config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("Error: GEMINI_API_KEY not found in environment variables. Make sure to create a .env file or set it in your shell");
    process.exit(1); // Exit the program if the API key is missing
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
  responseMimeType: "text/plain",
};

async function generateGifFrameDescription(promptText) {
    const chatSession = model.startChat({
      generationConfig,
      history: [],
    });

    try {
        const result = await chatSession.sendMessage(promptText);
        return result.response.text();
    } catch (error) {
        console.error("Error during generation:", error);
        return null;
    }
}

async function main() {
  // Example prompts (you can change these)

  const prompts = [
      "You are an AI assistant designed to create single frames for animated GIFs. Your task is to describe a single frame that could be part of an animation. Generate a detailed description of a single frame of a GIF showing a cat jumping over a red ball. The cat is mid-air, its paws are extended, and the ball is slightly below the cat. Use a simple, cartoonish art style. Do not describe the preceding or following frames, just this single moment.",
      "You are an AI that crafts descriptions for GIF animation frames. Generate the description of a single frame of a GIF showing a bustling city street at night. There are neon signs, cars with headlights on, and people walking on the sidewalks. The focus is on a food truck with a bright yellow sign, with a line of people waiting in front of it. Make the scene feel alive with motion. Do not describe any other frame.",
      "You are an AI specializing in crafting GIF animation frame descriptions. Describe one frame of a GIF showing a character's face expressing intense surprise. Their eyes are wide, their mouth is slightly open, and their eyebrows are raised high. The background is simple and blurred, so the focus remains on the face. Only describe the details of this single moment in time.",
      "You are a prompt engineer for GIF animations. Create the description for a single frame of a GIF. The frame shows a person walking on a beach during sunset. The scene should have a vibrant, low-poly art style, with the sun reflecting on the water. The person should be a simplified figure, walking toward the camera. Focus solely on describing the details of the single frame."
  ];


  for (const prompt of prompts) {
      console.log("----------------------------------");
      console.log("Prompt:\n", prompt);
      const frameDescription = await generateGifFrameDescription(prompt);

      if (frameDescription) {
         console.log("\nGenerated Frame Description:\n", frameDescription);
      } else {
          console.log("\nFailed to generate a frame description.");
      }
  }


}

main();
