import app from './app';
import { env } from './config/env';

const PORT = env.PORT || 3000;

const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`=======================================================`);
  console.log(` Vabatim Backend API running on http://${HOST}:${PORT}`);
  console.log(` Environment: ${env.NODE_ENV}`);
  console.log(` Speech Provider: ${env.SPEECH_PROVIDER}`);
  console.log(` Storage Provider: ${env.STORAGE_PROVIDER}`);
  console.log(`=======================================================`);
});
