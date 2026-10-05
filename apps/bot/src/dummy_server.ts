import http from 'http';
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Dashen Bot is alive and running!');
});
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🟢 Dummy server listening on port ${PORT} (keeps Render alive)`);
});
