const socket = new WebSocket('ws://localhost:3000');

const userStoryContainer = document.getElementById('userStoryContainer');

socket.addEventListener('open', (event) => {
    console.log("Connected to WebSocket");
});

socket.addEventListener('message', (event) => {
    try {
        const data = JSON.parse(event.data);
        if (data.type === "image") {
            const userStoryDiv = document.getElementById(`user-story-${data.userStoryID}`) || createUserStoryDiv(data.userStoryID);
            if (data.base64Strings && data.base64Strings.length > 0 ) {
                const img1 = document.createElement('img')
                img1.src = 'data:image/gif;base64,' + data.base64Strings[0];
                const img2 = document.createElement('img');
                img2.src = 'data:image/gif;base64,' + data.base64Strings[1];
                userStoryDiv.appendChild(img1);
                userStoryDiv.appendChild(img2);
           }
           userStoryDiv.dataset.status = data.status;
        }
    } catch(err) {
        console.error("Error processing event", err)
    }
});

function createUserStoryDiv(userStoryID) {
  const userStoryDiv = document.createElement('div');
  userStoryDiv.classList.add('user-story');
  userStoryDiv.id = `user-story-${userStoryID}`;
  userStoryDiv.innerHTML = `<h2>User Story: ${userStoryID}</h2>`;
  userStoryContainer.appendChild(userStoryDiv);
  return userStoryDiv;
}
socket.addEventListener('error', (error) => {
    console.error('WebSocket Error:', error);
});

socket.addEventListener('close', (event) => {
    console.log('WebSocket Closed:', event);
});