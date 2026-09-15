const http = require('http');

const port = process.env.PORT || '3000';
const service = '${{ values.repoName }}';

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/health') {
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (req.url.startsWith('/api/')) {
    res.end(JSON.stringify({ service, message: 'hola desde la API' }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(port, () => {
  console.log(`api ${service} escuchando en :${port}`);
});