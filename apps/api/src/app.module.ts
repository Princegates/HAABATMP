import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthGuard } from './common/auth.guard';
import { CoreModule } from './common/core.module';
import { AssessmentsModule } from './modules/assessments.module';
import { AttendanceModule } from './modules/attendance.module';
import { AuditModule } from './modules/audit.module';
import { AuthModule } from './modules/auth.module';
import { CertificatesModule } from './modules/certificates.module';
import { ComplianceModule } from './modules/compliance.module';
import { CoursesModule } from './modules/courses.module';
import { DashboardModule } from './modules/dashboard.module';
import { DeletionsModule } from './modules/deletions.module';
import { DocumentsModule } from './modules/documents.module';
import { EnrollmentsModule } from './modules/enrollments.module';
import { FinanceModule } from './modules/finance.module';
import { OrganizationsModule } from './modules/organizations.module';
import { ProgrammesModule } from './modules/programmes.module';
import { ReportsModule } from './modules/reports.module';
import { ResultsModule } from './modules/results.module';
import { SettingsModule } from './modules/settings.module';
import { UsersModule } from './modules/users.module';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
      // Test runs can switch the limiter off. It is ignored in production, which also refuses to boot with it set (config.ts).
      skipIf: () => process.env.NODE_ENV !== 'production' && process.env.THROTTLE_DISABLED === 'true',
    }),
    CoreModule, AuthModule, UsersModule, OrganizationsModule, CoursesModule, ProgrammesModule, EnrollmentsModule, AttendanceModule,
    AssessmentsModule, ResultsModule, CertificatesModule, FinanceModule, DocumentsModule, ComplianceModule, ReportsModule,
    AuditModule, SettingsModule, DashboardModule, DeletionsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: AuthGuard },
  ],
})
export class AppModule {}
