const socket = new WebSocket(`ws://localhost:${window.location.port}`);

const userStoryContainer = document.getElementById('userStoryContainer');

console.log(`Attempting to connect to WebSocket on port: ${window.location.port}`);

socket.addEventListener('open', (event) => {
    console.log("Connected to WebSocket");
    fetchUserStories();
});

socket.addEventListener('message', (event) => {
    try {
        const data = JSON.parse(event.data);
        if (data.type === "image") {
            const userStoryDiv = document.getElementById(`user-story-${data.userStoryID}`) || createUserStoryDiv(data.userStoryID, data.userStory, data.description, data.tags);
            
            // Clear existing images
            userStoryDiv.querySelectorAll('.image-container').forEach(imgContainer => imgContainer.remove());

            if (data.base64Strings && data.base64Strings.length >= 2) {
                try {
                    const imageContainer = document.createElement('div');
                    imageContainer.classList.add('image-container');
                    const gif = document.createElement('img');
                    gif.src = `image/gif;base64,${data.base64Strings.join('')}`;
                    imageContainer.appendChild(gif);
                    userStoryDiv.appendChild(imageContainer);
                } catch (error) {
                    console.error("Error creating or appending images:", error);
                }
            } else {
                console.error("Invalid base64 strings received:", data.base64Strings);
            }
           userStoryDiv.dataset.status = data.status;
           const statusDisplay = userStoryDiv.querySelector('.status-display');
           statusDisplay.textContent = `Status: ${data.status}`;
        }
    } catch(err) {
        console.error("Error processing event", err)
    }
});

function createUserStoryDiv(userStoryID, userStory, description, tags) {
  const userStoryDiv = document.createElement('div');
  userStoryDiv.classList.add('user-story');
  userStoryDiv.id = `user-story-${userStoryID}`;
  userStoryDiv.innerHTML = `
    <h2>User Story: ${userStoryID}</h2>
    <p><strong>User Story:</strong> ${userStory}</p>
    <p><strong>Description:</strong> ${description}</p>
    <p><strong>Tags:</strong> ${tags}</p>
    <p class="status-display"><strong>Status:</strong> Pending</p>
  `;
  userStoryContainer.appendChild(userStoryDiv);
  return userStoryDiv;
}
socket.addEventListener('error', (error) => {
    console.error('WebSocket Error:', error);
});

socket.addEventListener('close', (event) => {
    console.log('WebSocket Closed:', event);
});

async function fetchUserStories() {
    try {
        const response = await fetch('/user-stories');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const stories = await response.json();
        stories.forEach(story => {
            createUserStoryDiv(story.ID, story.userStory, story.description, story.tags);
            const userStoryDiv = document.getElementById(`user-story-${story.ID}`);
            if (userStoryDiv) {
                userStoryDiv.dataset.status = story.status;
                const statusDisplay = userStoryDiv.querySelector('.status-display');
                statusDisplay.textContent = `Status: ${story.status}`;
            }
        });
    } catch (error) {
        console.error("Failed to fetch user stories:", error);
    }
}
