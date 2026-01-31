const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const { initializeSockets } = require('./socketManager');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); 

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize WebSocket Logic
initializeSockets(wss);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`Tracker server running on port ${PORT}`);
});
//doooooneee