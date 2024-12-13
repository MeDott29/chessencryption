const {
    GoogleGenerativeAI,
    HarmCategory,
    HarmBlockThreshold,
  } = require("@google/generative-ai");
const fs = require('node:fs/promises');

const apiKey = process.env.GEMINI_API_KEY;
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
  const safetySettings = [
    {
      category: HarmCategory.HARM_CATEGORY_HARASSMENT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
  ]
const userStoriesFile = 'user_stories.txt';

async function generateUserStory() {
    const chatSession = model.startChat({
        generationConfig,
        safetySettings,
        history: [],
      });
    const prompt = `Generate a user story for a GIF animation, including a description of the GIF frame.
    The user story should follow the format: "As a [user role], I want [a goal], So that [a benefit]".
    The description should be a detailed description of a single frame of the GIF.
    The response should be formatted as a JSON object with the keys "userStory", "description".`
    console.log("generateUserStory prompt:", prompt)
    try {
        const result = await chatSession.sendMessage(prompt);
        try {
            let responseText = result.response.text();
            // Remove markdown code fences if present
            responseText = responseText.replace(/```json\n/g, '').replace(/```/g, '');
            const response = JSON.parse(responseText);
            console.log("generateUserStory response:", response)
            return response;
        } catch (error) {
            console.error("Failed to parse JSON response", error);
            return null;
        }
    } catch (error) {
        console.error("Failed to generate user story", error)
        return null;
    }
}
async function generateBase64FrameData() {
    // Hardcoded base64 string for a simple 2-frame GIF
    const base64Strings = [
        "R0lGODlhCgAKAIABAAAAAP///yH5BAEAAAEALAAAAAAKAAoAAAIXjI+py+0Po5y02ouz3rz7D4biSJbmiabqyrbuC8fyTNf2Pf53f4E9RDy+c+AAgBNAAAA7",
        "R0lGODlhCgAKAIABAAAAAP///yH5BAEAAAEALAAAAAAKAAoAAAIXjI+py+0Po5y02ouz3rz7D4biSJbmiabqyrbuC8fyTNf2Pf53f4E9RDy+c+AAgBNAAAA7"
    ];
    console.log("generateBase64FrameData response:", base64Strings)
    return base64Strings;
}
async function appendNewUserStory() {
    const userStoryData = await generateUserStory();
    if (!userStoryData) {
        console.error("Could not generate user story data");
        return;
    }
    const {userStory, description} = userStoryData;
    const base64Strings = await generateBase64FrameData();
    if (!userStory || !description || !base64Strings) {
        console.error("Could not generate all required data for user story")
        return;
    }
    const stories = await readUserStories();
    const nextID = stories.length > 0 ? Math.max(...stories.map(story => story.ID)) + 1 : 1;
    const newStory = {
        ID: nextID,
        userStory: userStory,
        description: description,
        tags: "generated",
        status: "Pending",
        base64Strings: base64Strings
    }
    let output = `ID: ${newStory.ID}\n`;
    output += `User Story: ${newStory.userStory}\n`;
    output += `Description: ${newStory.description}\n`;
    output += `Tags: ${newStory.tags}\n`;
    output += `Status: ${newStory.status}\n`;
    output += `Base64Strings: ${JSON.stringify(newStory.base64Strings)}\n\n`;
    try {
        await fs.appendFile(userStoriesFile, output);
        console.log("Appended new user story to user_stories.txt")
    } catch (error) {
        console.error("Failed to append new user story to file", error)
    }
}
async function readUserStories() {
    try {
        const data = await fs.readFile(userStoriesFile, 'utf-8');
        const stories = [];
        let currentStory = {};
        for (const line of data.split('\n')) {
            if (line.startsWith('ID:')) {
                if (currentStory.ID) {
                    stories.push(currentStory);
                }
                currentStory = { ID: parseInt(line.split(': ')[1]) };
            } else if (line.startsWith('User Story:')) {
                currentStory.userStory = line.split(': ')[1];
            } else if (line.startsWith('Description:')) {
                currentStory.description = line.split(': ')[1];
            } else if (line.startsWith('Tags:')) {
                currentStory.tags = line.split(': ')[1];
            } else if (line.startsWith('Status:')) {
                currentStory.status = line.split(': ')[1];
            } else if (line.startsWith('Base64Strings:')) {
                try {
                    currentStory.base64Strings = JSON.parse(line.split(': ')[1]);
                } catch (e) {
                    console.error("Could not parse base64 strings", e)
                    currentStory.base64Strings = [];
                }
            }
        }
           if (currentStory.ID) {
                    stories.push(currentStory);
            }
        return stories;
    } catch (error) {
        console.error('Error reading user stories file:', error);
        return [];
    }
}
module.exports = { appendNewUserStory };
