import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { timingSafeEqual } from 'node:crypto';
import { AllExceptionsFilter } from './common/http-exception.filter';

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'] });
  app.set('trust proxy', 1); // Render sits behind one proxy; req.ip must be the real client
  app.use(helmet());
  // The web app sits between the browser and this API, so every request arrives from the web server's address. It passes
  // the real client address along, and we believe it only when it proves it is the web app by sharing a secret.
  const secret = process.env.PROXY_SHARED_SECRET;
  if (secret) {
    const want = Buffer.from(secret);
    app.use((req: any, _res: any, next: () => void) => {
      const key = req.headers['x-atmp-proxy-key'];
      const ip = req.headers['x-atmp-client-ip'];
      if (typeof key === 'string' && typeof ip === 'string' && key.length === want.length && timingSafeEqual(Buffer.from(key), want) && /^[0-9a-fA-F:.]{3,45}$/.test(ip)) {
        Object.defineProperty(req, 'ip', { value: ip, configurable: true });
      }
      next();
    });
  }
  app.useBodyParser('json', { limit: '1mb' });
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  return app;
}

if (require.main === module) {
  createApp().then((app) => app.listen(Number(process.env.PORT ?? 4000), '0.0.0.0'));
}
