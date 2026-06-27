const socket = io();
let currentUserId = null;
let currentRoomId = null;

// 1. Auto Login on Load
socket.on('connect', () => {
    socket.emit('login', { username: 'TestUser_' + Math.floor(Math.random() * 1000) });
});

socket.on('login_success', (data) => {
    currentUserId = data.userId;
    console.log('Logged in as:', data.username);
});

// 2. Room List
socket.on('room_list', (rooms) => {
    const list = document.getElementById('roomList');
    if (rooms.length === 0) {
        list.innerHTML = '<div class="empty-state">No chats yet. Create one!</div>';
        return;
    }
    list.innerHTML = rooms.map(r => `
        <div class="room-item" onclick="joinRoom(${r.id})">
            <div class="room-name">${r.name}</div>
            <div class="room-last">${r.lastMessage}</div>
        </div>
    `).join('');
});

socket.on('room_list_update', () => {
    socket.emit('get_rooms');
});

// 3. Create Room
function createRoom() {
    const name = prompt('Enter room name:');
    if (name) socket.emit('create_room', { roomName: name });
}

// 4. Join Room
function joinRoom(roomId) {
    currentRoomId = roomId;
    socket.emit('join_room', roomId);
}

socket.on('room_joined', (data) => {
    document.getElementById('chatHeader').style.display = 'flex';
    document.getElementById('inputArea').style.display = 'flex';
    document.getElementById('roomName').textContent = data.room.name;
    
    const msgContainer = document.getElementById('messages');
    msgContainer.innerHTML = '';
    data.messages.forEach(msg => addMessage(msg));
});

// 5. Send Message
function sendMessage() {
    const input = document.getElementById('msgInput');
    const text = input.value.trim();
    if (!text || !currentRoomId) return;
    socket.emit('send_message', { roomId: currentRoomId, message: text });
    input.value = '';
}

// 6. Receive Message
socket.on('new_message', (msg) => {
    if (currentRoomId === msg.roomId) {
        addMessage(msg);
    }
});

function addMessage(msg) {
    const container = document.getElementById('messages');
    const div = document.createElement('div');
    const isMine = msg.senderId === currentUserId;
    div.className = `msg-row ${isMine ? 'mine' : 'other'}`;
    div.innerHTML = `
        <div class="msg-bubble">
            ${!isMine ? `<div class="msg-username">${msg.username}</div>` : ''}
            <div>${msg.text}</div>
            <div class="msg-time">${msg.timestamp}</div>
        </div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// 7. Leave Room
function leaveRoom() {
    currentRoomId = null;
    document.getElementById('chatHeader').style.display = 'none';
    document.getElementById('inputArea').style.display = 'none';
    document.getElementById('messages').innerHTML = '<div class="placeholder">Select a chat to start messaging</div>';
    socket.emit('get_rooms');
}
