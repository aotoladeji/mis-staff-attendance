import app from './app.js';
import { initDB } from './db.js';

const PORT = process.env.SERVER_PORT || 5001;

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`ITeMS || Staff Attendance API running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialise database:', err.message);
    process.exit(1);
  });
