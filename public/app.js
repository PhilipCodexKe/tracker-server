const output = document.getElementById('output');
const clock = document.getElementById('clock');
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${window.location.host}`;

// Dynamic Hostname for UI
document.querySelector('.ip').innerText = `NODE: ${window.location.hostname.toUpperCase()}`;

// History Array (Temporary Persistence)
const logHistory = [];

let ws;

function updateClock() {
    const now = new Date();
    clock.textContent = now.toLocaleTimeString();
}
setInterval(updateClock, 1000);

function log(message, type = 'info') {
    const now = new Date();
    const timestamp = now.toLocaleTimeString();
    
    // Store in array
    logHistory.push({ timestamp, message, type });

    // Render to DOM
    const line = document.createElement('div');
    line.className = 'line';
    line.innerHTML = `<span style="opacity:0.6">[${timestamp}]</span> ${message}`;
    
    if (type === 'error') line.style.color = '#ff5555';
    if (type === 'success') line.style.color = '#50fa7b';
    if (type === 'warning') line.style.color = '#f1fa8c';
    if (type === 'system') line.style.color = '#bd93f9'; // Purple for system events
    
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
}

function connect() {
    log('Initiating handshake protocol...', 'info');
    
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        log('Connection established [SECURE]', 'success');
        log('Waiting for network activity...');
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            
            switch (data.type) {
                case 'welcome':
                    log(`Identity assigned: ${data.peerId}`, 'success');
                    document.title = `NODE: ${data.peerId.substring(0, 8)}...`;
                    break;
                case 'greeting':
                    log(data.message, 'success');
                    break;
                case 'error':
                    log(`Error: ${data.message}`, 'error');
                    break;
                case 'peer-joined':
                    log(`New Peer Detected: ${data.peerId}`, 'system');
                    break;
                case 'peer-left':
                    log(`Peer Disconnected: ${data.peerId}`, 'warning');
                    break;
                case 'peers':
                    log(`Swarm update: ${data.peers.length} active peers`, 'info');
                    break;
                case 'signal':
                    log(`Encrypted signal received from ${data.from}`, 'info');
                    break;
                default:
                    log(`Data received: ${data.type}`);
            }
        } catch (e) {
            log('Raw packet received', 'info');
        }
    };

    ws.onclose = () => {
        log('Connection lost. Retrying in 5000ms...', 'error');
        setTimeout(connect, 5000);
    };

    ws.onerror = (err) => {
        log(`Socket error: ${err.message || 'Unknown'}`, 'error');
        ws.close();
    };
}

// Start
connect();
