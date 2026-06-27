const express = require('express');
const http = require('http'); // ✅ http ကိုပဲ သုံးမယ်
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();

// ✅ CORS: အကုန်လုံးအတွက် ခွင့်ပြုမယ် (Mobile/Desktop/Other)
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(__dirname));

// ✅ In-Memory Database (Chat Data)
const db = {
    users: {},      // { userId: { id, username, socketId } }
    rooms: {},      // { roomId: { id, name, type, participants: [userId], messages: [], createdBy } }
    userIdCounter: 1,
    roomIdCounter: 1
};

// ✅ Server Create (HTTP) - Render က HTTPS ကို auto-convert လုပ်ပေးမယ်
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ✅ Frontend Route (chat.html)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'chat.html'));
});

// ==================== SOCKET.IO ====================
io.on('connection', (socket) => {
    console.log('✅ Socket connected:', socket.id);

    // 1. User Login (Auto-Guest)
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

    // 2. Create Room
    socket.on('create_room', (data) => {
        const roomName = data.roomName || 'New Chat';
        const userId = socket.userId;
        if (!userId) return;

        const roomId = db.roomIdCounter++;
        const newRoom = {
            id: roomId,
            name: roomName,
            type: 'private',
            participants: [userId],
            messages: [],
            createdBy: userId
        };
        db.rooms[roomId] = newRoom;
        socket.join('room_' + roomId);

        socket.emit('room_created', newRoom);
        io.emit('room_list_update');
        console.log(`📌 Room created: ${roomName} (ID: ${roomId}) by ${socket.username}`);
    });

    // 3. Join Room
    socket.on('join_room', (roomId) => {
        const room = db.rooms[roomId];
        if (!room) return socket.emit('error', 'Room not found');

        if (!room.participants.includes(socket.userId)) {
            room.participants.push(socket.userId);
        }
        socket.join('room_' + roomId);
        
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
            roomId: roomId,
            senderId: socket.userId,
            username: socket.username,
            text: text,
            timestamp: new Date().toISOString(),
            isRead: false
        };
        room.messages.push(msg);

        // ✅ Send to everyone in the room (Cross-Platform)
        io.to('room_' + roomId).emit('new_message', msg);
        console.log(`📨 ${socket.username} sent: ${text}`);
    });

    // 5. Get Rooms
    socket.on('get_rooms', () => {
        socket.emit('room_list', getRoomListForUser(socket.userId));
    });

    // 6. Disconnect
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

// ==================== HELPER FUNCTION ====================
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

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Test Chat Server running on port ${PORT}`);
    console.log(`📌 Database: In-Memory (No PostgreSQL)`);
});
