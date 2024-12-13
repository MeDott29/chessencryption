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
const imageDatabaseFile = 'image_database.txt';
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
async function writeUserStories(stories) {
    let output = '';
    for (const story of stories) {
      output += `ID: ${story.ID}\n`;
      output += `User Story: ${story.userStory}\n`;
      output += `Description: ${story.description}\n`;
      output += `Tags: ${story.tags}\n`;
      output += `Status: ${story.status}\n\n`;
    }
    try{
        await fs.writeFile(userStoriesFile, output);
        console.log("Updated user_stories.txt")
    } catch (err) {
          console.error('Error writing user stories file:', err);
    }
}
async function findNextPendingStory(stories) {
  return stories.find(story => story.status === 'Pending');
}
async function updateStoryStatus(stories, storyID, newStatus) {
    return stories.map(story => {
      if (story.ID === storyID) {
        return { ...story, status: newStatus };
      }
      return story;
    });
}
async function addToImageDatabase(userStoryID, base64String) {
    const entry = `user_story_id: ${userStoryID}, base64_string: ${base64String}\n`;
    try{
         await fs.appendFile(imageDatabaseFile, entry);
          console.log('Appended image data to image_database.txt');
    } catch (err) {
          console.error('Error writing to image database file:', err);
    }
}
async function run() {
  const chatSession = model.startChat({
    generationConfig,
    safetySettings,
    history: [],
  });
    const stories = await readUserStories();
    if (!stories || stories.length === 0) {
        console.log("No user stories found")
    }
  let nextStory = await findNextPendingStory(stories);
  if (!nextStory) {
    console.log('No pending user stories found.');
    return;
  }
  const userStoryID = nextStory.ID;
  console.log(`Processing user story ${userStoryID}`)
  let updatedStories = await updateStoryStatus(stories, userStoryID, "In Progress");
  await writeUserStories(updatedStories);
    const prompt = "Generate a single, very small, square image, focusing on a single low-poly triangle. The triangle should be in bright orange (#FFA500) on a dark grey (#333333) background. The image must be delivered as a base64 string for a GIF frame. No other text is needed. Make it very small, like a few pixels.";
  const result = await chatSession.sendMessage(prompt);

  const base64Image = result.response.text();
    updatedStories = await updateStoryStatus(updatedStories, userStoryID, "Done");
    await writeUserStories(updatedStories);
    await addToImageDatabase(userStoryID, base64Image);

}
run();