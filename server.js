const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(__dirname));

const db = {
    users: {}, rooms: {}, userIdCounter: 1, roomIdCounter: 1
};

const server = http.createServer(app);

// ✅ CORS ကို သေချာပြင်ထားတယ်
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    allowEIO3: true,
    transports: ['polling', 'websocket']
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'chat.html'));
});

io.on('connection', (socket) => {
    console.log('✅ Socket connected:', socket.id);

    socket.on('login', (data) => {
        let username = data.username || 'Guest_' + db.userIdCounter;
        let userId = db.userIdCounter++;
        db.users[userId] = { id: userId, username, socketId: socket.id };
        socket.userId = userId;
        socket.username = username;
        socket.emit('login_success', { userId, username });
        socket.emit('room_list', getRoomListForUser(userId));
        console.log(`👤 User logged in: ${username} (ID: ${userId})`);
    });

    socket.on('create_room', (data) => {
        const roomName = data.roomName || 'New Chat';
        const userId = socket.userId;
        if (!userId) return;
        const roomId = db.roomIdCounter++;
        const newRoom = { id: roomId, name: roomName, type: 'private', participants: [userId], messages: [], createdBy: userId };
        db.rooms[roomId] = newRoom;
        socket.join('room_' + roomId);
        socket.emit('room_created', newRoom);
        io.emit('room_list_update');
        console.log(`📌 Room created: ${roomName} (ID: ${roomId})`);
    });

    socket.on('join_room', (roomId) => {
        const room = db.rooms[roomId];
        if (!room) return socket.emit('error', 'Room not found');
        if (!room.participants.includes(socket.userId)) {
            room.participants.push(socket.userId);
        }
        socket.join('room_' + roomId);
        socket.emit('room_joined', { room, messages: room.messages });
    });

    socket.on('send_message', (data) => {
        const roomId = data.roomId;
        const text = data.message;
        const room = db.rooms[roomId];
        if (!room || !text) return;
        const msg = { id: Date.now(), roomId, senderId: socket.userId, username: socket.username, text, timestamp: new Date().toISOString() };
        room.messages.push(msg);
        io.to('room_' + roomId).emit('new_message', msg);
        console.log(`📨 ${socket.username} sent: ${text}`);
    });

    socket.on('get_rooms', () => {
        socket.emit('room_list', getRoomListForUser(socket.userId));
    });

    socket.on('disconnect', () => {
        console.log('❌ Socket disconnected:', socket.id);
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
        .map(r => ({ id: r.id, name: r.name, type: r.type, lastMessage: r.messages.length > 0 ? r.messages[r.messages.length-1].text : 'No messages' }));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Test Chat Server running on port ${PORT}`);
});
