const WebSocket = require('ws');
const ws = new WebSocket('wss://redisgen.onrender.com');

ws.on('open', () => {
    console.log('Connected');
    ws.send(JSON.stringify({ id: 1, command: ['AUTH', 'testpass'] }));
});

ws.on('message', (data) => {
    console.log('Message:', data.toString());
    process.exit(0);
});
