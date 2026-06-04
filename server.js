const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Разрешаем подключения откуда угодно
        methods: ["GET", "POST"]
    }
});

const activeConnections = new Map();

io.on('connection', (socket) => {
    console.log(`[Socket] Подключен клиент: ${socket.id}`);

    socket.on('connect-tiktok', async (username) => {
        if (!username) return;
        console.log(`[TikTok] Запрос на подключение к: ${username}`);

        socket.join(username);

        if (activeConnections.has(username)) {
            socket.emit('tiktok-status', { status: 'connected', message: 'Уже подключено' });
            return;
        }

        const tiktokLiveConnection = new WebcastPushConnection(username);
        activeConnections.set(username, tiktokLiveConnection);

        try {
            const state = await tiktokLiveConnection.connect();
            console.log(`[TikTok] Успешно подключено к комнате ${state.roomId}`);
            io.to(username).emit('tiktok-status', { status: 'connected', roomInfo: state });

            tiktokLiveConnection.on('like', data => {
                io.to(username).emit('tiktok-event', {
                    type: 'like',
                    data: {
                        userId: data.userId,
                        nickname: data.uniqueId,
                        likeCount: data.likeCount,
                        totalLikes: data.totalLikeCount
                    }
                });
            });

            tiktokLiveConnection.on('gift', data => {
                if (data.giftType === 1 && !data.repeatEnd) return;
                io.to(username).emit('tiktok-event', {
                    type: 'gift',
                    data: {
                        userId: data.userId,
                        nickname: data.uniqueId,
                        giftName: data.giftName,
                        diamondCount: data.diamondCount * data.repeatCount,
                        avatar: data.profilePictureUrl
                    }
                });
            });

            tiktokLiveConnection.on('follow', data => {
                io.to(username).emit('tiktok-event', {
                    type: 'follow',
                    data: { nickname: data.uniqueId }
                });
            });

            tiktokLiveConnection.on('streamEnd', () => {
                console.log(`[TikTok] Стрим ${username} завершен`);
                io.to(username).emit('tiktok-status', { status: 'disconnected', message: 'Стрим завершен' });
                activeConnections.delete(username);
            });

        } catch (err) {
            console.error(`[TikTok] Ошибка подключения к ${username}:`, err.message);
            io.to(username).emit('tiktok-status', { status: 'error', message: err.message });
            activeConnections.delete(username);
        }
    });

    socket.on('disconnect', () => {
        console.log(`[Socket] Отключен клиент: ${socket.id}`);
    });
});

// Railway сам задает переменную PORT
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[Server] Запущен на порту ${PORT}`);
});
