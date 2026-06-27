const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(__dirname)); // ✅ Dashboard နဲ့ Chat HTML တွေကို ရှာဖို့

// ==================== IN-MEMORY DATABASE (Chat & Users) ====================
const db = {
    users: {},      // { userId: { id, username, socketId } }
    rooms: {},      // { roomId: { id, name, type, participants: [userId], messages: [], createdBy } }
    userIdCounter: 1,
    roomIdCounter: 1
};

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: '*' },
    transports: ['polling', 'websocket']
});

// ✅ Dashboard Route ကို အရင်ထားပါ (ဒါမှ /dashboard ကို ဦးစားပေးမယ်)
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// ✅ Chat Route (Root) ကို အောက်မှာထားပါ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'chat.html'));
});

// ✅ ==================== DASHBOARD MOCK APIs (Test Data) ====================

// 1. Slider Images
app.get('/api/slider_images', (req, res) => {
    res.json({ 
        success: true, 
        images: [
            'https://i.ibb.co/jP75GWJt/theme-DDw1t3gk.jpg',
            'https://i.ibb.co/RT99hkvw/file-00000000cbdc7208b3dbfa85e5ec0111.png'
        ] 
    });
});

// 2. Notice (Dashboard Notice)
app.get('/api/notice', (req, res) => {
    res.json({ 
        success: true, 
        message: 'SOLO M Game Store Test Server မှ ကြိုဆိုပါသည်။ Update အသစ်များကို ဤနေရာတွင် စမ်းသပ်ကြည့်ရှုနိုင်ပါသည်။',
        color: '#2ecc71',
        created_at: new Date().toISOString()
    });
});

// 3. Video Player
app.get('/api/video', (req, res) => {
    res.json({ 
        success: true, 
        url: 'https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&mute=1&playsinline=1', // Test Video
        isYouTube: true 
    });
});

// 4. User Balance (Test Data)
app.post('/api/get_balance', (req, res) => {
    res.json({ balance: 50000 }); // Test Balance
});

// 5. Check Banned (Test - Never Banned)
app.post('/api/check_banned', (req, res) => {
    res.json({ banned: false });
});

// 6. Chat Unread Badge (Test - No Unread)
app.post('/api/chat/unread', (req, res) => {
    res.json({ count: 0 });
});

// 7. Logout (Test)
app.post('/api/logout', (req, res) => {
    res.json({ success: true });
});

// 8. Page Status (Test - All ON)
app.get('/api/admin/page_status', (req, res) => {
    res.json({ 
        pages: [
            { id: 'dashboard', status: 'on' },
            { id: 'topup', status: 'on' }
        ] 
    });
});

// ✅ ==================== CHAT SYSTEM (Socket.io) ====================
io.on('connection', (socket) => {
    console.log('✅ Socket connected:', socket.id);

    // 1. User Login
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
        const newRoom = { id: roomId, name: roomName, type: 'private', participants: [userId], messages: [], createdBy: userId };
        db.rooms[roomId] = newRoom;
        socket.join('room_' + roomId);
        socket.emit('room_created', newRoom);
        io.emit('room_list_update');
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
        socket.emit('room_joined', { room, messages: room.messages });
        console.log(`📌 User ${socket.username} joined room: ${roomId}`);
    });

    // 4. Send Message
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
    console.log(`✅ Test Server running on port ${PORT}`);
    console.log(`📌 Dashboard: /dashboard`);
    console.log(`💬 Chat: / (Root)`);
    console.log(`📌 Database: In-Memory (No PostgreSQL)`);
});
