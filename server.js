const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
 
const app = express();
const server = http.createServer(app);
const io = new Server(server);
 
app.use(express.json());
app.use(express.static('public'));
 
// Load categories from JSON
const categories = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'categories.json'), 'utf8')
);
 
// In-memory data store (persists as long as server is running)
const players = {};   // { playerName: { picks: { categoryId: nomineeName }, submittedAt: string } }
const winners = {};   // { categoryId: nomineeName }
 
// Admin key — change this to whatever you want
const ADMIN_KEY = 'oscar2026';
 
function getLeaderboard() {
  const board = Object.entries(players).map(([name, data]) => {
    let score = 0;
    let correct = 0;
    let total = Object.keys(winners).length;
 
    for (const [catId, pick] of Object.entries(data.picks)) {
      if (winners[catId] && winners[catId] === pick) {
        const cat = categories.find(c => c.id === catId);
        score += cat ? cat.points : 1;
        correct++;
      }
    }
 
    return { name, score, correct, total, picks: data.picks };
  });
 
  board.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return board;
}
 
function broadcastState() {
  io.emit('stateUpdate', {
    leaderboard: getLeaderboard(),
    winners,
    playerCount: Object.keys(players).length,
    categoriesAnnounced: Object.keys(winners).length,
    totalCategories: categories.length
  });
}
 
// Socket.io connections
io.on('connection', (socket) => {
  // Send initial state to new connection
  socket.emit('init', {
    categories,
    players,
    winners,
    leaderboard: getLeaderboard()
  });
 
  // Player submits their picks
  socket.on('submitPicks', ({ name, picks }) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    players[trimmed] = { picks, submittedAt: new Date().toISOString() };
    broadcastState();
  });
 
  // Admin marks a winner
  socket.on('setWinner', ({ categoryId, nominee, adminKey }) => {
    if (adminKey !== ADMIN_KEY) {
      socket.emit('adminError', 'Wrong admin key');
      return;
    }
    winners[categoryId] = nominee;
 
    // Save winners to disk so you don't lose them on restart
    fs.writeFileSync(
      path.join(__dirname, 'data', 'winners.json'),
      JSON.stringify(winners, null, 2)
    );
 
    broadcastState();
  });
 
  // Admin clears a winner (in case of mistake)
  socket.on('clearWinner', ({ categoryId, adminKey }) => {
    if (adminKey !== ADMIN_KEY) return;
    delete winners[categoryId];
    broadcastState();
  });
});
 
// Restore saved winners on startup if file exists
try {
  const saved = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'data', 'winners.json'), 'utf8')
  );
  Object.assign(winners, saved);
} catch (e) {
  // No saved winners, that's fine
}
 
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🏆 Oscar Pool is live at http://localhost:${PORT}\n`);
});