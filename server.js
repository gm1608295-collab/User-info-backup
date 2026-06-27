const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-Memory Database (Chat Rooms & Messages)
const db = {
    rooms: {}, // roomId -> { id, name, type, participants: [userId], messages: [], createdBy }
    users: {}, // userId -> { id, username, socketId }
    roomIdCounter: 1,
    userIdCounter: 1
};

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

io.on('connection', (socket) => {
    console.log('✅ Socket connected:', socket.id);

    // 1. User Login / Register
    socket.on('login', (data) => {
        let userId = data.userId;
        let username = data.username || 'Guest_' + db.userIdCounter;

        // If user already exists, update socket
        if (userId && db.users[userId]) {
            db.users[userId].socketId = socket.id;
            socket.userId = userId;
            socket.username = db.users[userId].username;
        } else {
            // Create new user
            userId = db.userIdCounter++;
            db.users[userId] = { id: userId, username, socketId: socket.id };
            socket.userId = userId;
            socket.username = username;
        }

        socket.emit('login_success', { userId, username });
        socket.emit('room_list', getRoomListForUser(userId));
        console.log(`👤 User logged in: ${username} (ID: ${userId})`);
    });

    // 2. Create Room
    socket.on('create_room', (data) => {
        const roomName = data.roomName || 'New Chat';
        const userId = socket.userId;
        if (!userId) return;

        const roomId = db.roomIdCounter++;
        const newRoom = {
            id: roomId,
            name: roomName,
            type: data.type || 'private',
            participants: [userId],
            messages: [],
            createdBy: userId
        };
        db.rooms[roomId] = newRoom;
        socket.join('room_' + roomId);

        socket.emit('room_created', newRoom);
        io.emit('room_list_update'); // Update all users
        console.log(`📌 Room created: ${roomName} (ID: ${roomId})`);
    });

    // 3. Join Room
    socket.on('join_room', (roomId) => {
        const room = db.rooms[roomId];
        if (!room) return socket.emit('error', 'Room not found');

        if (!room.participants.includes(socket.userId)) {
            room.participants.push(socket.userId);
        }
        socket.join('room_' + roomId);
        
        // Send existing messages
        socket.emit('room_joined', { room, messages: room.messages });
        console.log(`📌 User ${socket.username} joined room: ${roomId}`);
    });

    // 4. Send Message
    socket.on('send_message', (data) => {
        const roomId = data.roomId;
        const text = data.message;
        const room = db.rooms[roomId];
        if (!room || !text) return;

        const msg = {
            id: Date.now(),
            senderId: socket.userId,
            username: socket.username,
            text: text,
            timestamp: new Date().toLocaleTimeString(),
            isMine: false
        };
        room.messages.push(msg);

        // Send to everyone in the room
        io.to('room_' + roomId).emit('new_message', { ...msg, isMine: false });
        console.log(`📨 ${socket.username}: ${text}`);
    });

    // 5. Get Rooms
    socket.on('get_rooms', () => {
        socket.emit('room_list', getRoomListForUser(socket.userId));
    });

    // 6. Disconnect
    socket.on('disconnect', () => {
        console.log('❌ Socket disconnected:', socket.id);
        // Remove user from memory if socket disconnects
        for (const [userId, user] of Object.entries(db.users)) {
            if (user.socketId === socket.id) {
                delete db.users[userId];
                break;
            }
        }
    });
});

function getRoomListForUser(userId) {
    return Object.values(db.rooms)
        .filter(r => r.participants.includes(userId))
        .map(r => ({
            id: r.id,
            name: r.name,
            type: r.type,
            lastMessage: r.messages.length > 0 ? r.messages[r.messages.length-1].text : 'No messages'
        }));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Test Chat Server running on port ${PORT}`);
    console.log(`📌 Database: In-Memory (No PostgreSQL)`);
});
