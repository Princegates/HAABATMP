import { Global, Module } from '@nestjs/common';
import { ENV, loadEnv } from '../config';
import { AuditService } from './audit.service';
import { AuthGuard } from './auth.guard';
import { CryptoService } from './crypto.service';
import { Db } from './db.service';
import { InvoicingService } from './invoicing.service';
import { Mailer } from './mailer.service';
import { NotifyService } from './notify.service';
import { NumberingService } from './numbering.service';
import { SettingsService } from './settings.service';
import { MalwareScanner, StorageService } from './storage.service';
import { TokenService } from './token.service';

const shared = [Db, AuditService, CryptoService, Mailer, NotifyService, SettingsService, StorageService, MalwareScanner, TokenService, AuthGuard, NumberingService, InvoicingService];

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }, ...shared],
  exports: [ENV, ...shared],
})
export class CoreModule {}
