const express = require('./node_modules/express');
const app = express();
const router = express.Router();

router.use((req, res) => {
  res.json({ method: req.method, path: req.path, url: req.url, originalUrl: req.originalUrl });
});

app.use('/proxy', router);

const server = app.listen(0, async () => {
  const port = server.address().port;
  const res = await fetch(`http://localhost:${port}/proxy/test/path?foo=bar`, { method: 'POST' });
  console.log(await res.json());
  server.close();
});
